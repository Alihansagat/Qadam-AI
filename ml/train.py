"""Offline training. No user data is sent to a service. Import JSON in Qadam."""
import argparse
import json
import math
import subprocess
from datetime import date, timedelta
from pathlib import Path
import numpy as np
import catboost
import lightgbm
import sklearn
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ['lag_1', 'lag_7', 'lag_14', 'mean_7', 'mean_14', 'weekday_sin', 'weekday_cos']

def features(past, day):
    """Only observations strictly before target day. No future rolling values."""
    angle = 2 * math.pi * day.weekday() / 7
    return [past[-1], past[-7], past[-14], np.mean(past[-7:]), np.mean(past[-14:]), math.sin(angle), math.cos(angle)]

def fit_predict(values, dates, horizon, method):
    x = np.asarray([features(values[:i], dates[i]) for i in range(14, len(values))])
    y = np.asarray(values[14:])
    if method == 'catboost':
        model = catboost.CatBoostRegressor(iterations=80, depth=4, learning_rate=.05, loss_function='RMSE', random_seed=41, thread_count=1, verbose=False, allow_writing_files=False)
        model.fit(x, y)
        predict = lambda row: model.predict(np.asarray([row]))[0]
    else:
        model = lightgbm.LGBMRegressor(n_estimators=80, num_leaves=7, min_child_samples=5, learning_rate=.05, random_state=41, n_jobs=1, verbosity=-1, deterministic=True, force_col_wise=True)
        model.fit(x, y)
        predict = lambda row: model.booster_.predict(np.asarray([row]), num_threads=1)[0]
    past = list(values)
    predictions = []
    for step in range(horizon):
        # Recursive forecasts cannot see actual held-out sales.
        value = max(0., float(predict(features(past, dates[-1] + timedelta(days=step + 1)))))
        predictions.append(value)
        past.append(value)
    return predictions

def anomaly_features(values, dates, i):
    baseline = float(np.mean(values[i-7:i]))
    return [values[i], values[i] - baseline, values[i] / (baseline + 1), math.sin(2*math.pi*dates[i].weekday()/7), math.cos(2*math.pi*dates[i].weekday()/7)]

def train(payload):
    groups = {}
    for row in payload['rows']:
        groups.setdefault(row['sku'], []).append(row)
    report = {'schema': 1, 'fingerprint': payload['fingerprint'], 'source': payload['source'], 'features': FEATURES,
              'versions': {'catboost':catboost.__version__, 'lightgbm':lightgbm.__version__, 'sklearn':sklearn.__version__},
              'protocol': 'Expanding-window 14-day validation; last 14 days held out; fixed hyperparameters; recursive forecast; final fit on all history.', 'products': {}}
    for sku, rows in groups.items():
        rows.sort(key=lambda r:r['date'])
        if len(rows) < 70:
            continue
        values = [r['units'] for r in rows]
        dates = [date.fromisoformat(r['date']) for r in rows]
        end = len(rows)-14
        folds = min(3, (end-28)//14)
        models = {}
        for method in ['catboost','lightgbm']:
            validation = []
            for origin in range(end-folds*14,end,14):
                validation.extend(fit_predict(values[:origin],dates[:origin],14,method))
            models[method] = {'validation':validation,'test':fit_predict(values[:end],dates[:end],14,method),'forecast':fit_predict(values,dates,120,method)}
        detector = IsolationForest(n_estimators=150, contamination='auto', random_state=41, n_jobs=1)
        detector.fit([anomaly_features(values,dates,i) for i in range(14,end)])
        scores = detector.decision_function([anomaly_features(values,dates,i) for i in range(end,len(rows))])
        anomalies = [{'date':rows[end+i]['date'],'score':float(score),'flag':bool(score<0)} for i,score in enumerate(scores)]
        report['products'][sku] = {'end':rows[-1]['date'],'days':len(rows),'models':models,'anomalies':anomalies}
        print(f'Trained {sku}: {len(rows)} days, {folds} validation windows', flush=True)
    if not report['products']:
        raise ValueError('At least one product needs 70 consecutive days of sales.')
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--demo', action='store_true')
    source.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'output/ml-report.json')
    args = parser.parse_args()
    payload = json.loads(subprocess.check_output(['node',str(ROOT/'ml/prepare.mjs'),'--demo' if args.demo else str(args.input.resolve())], text=True))
    report = train(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    print(f'Saved {args.output}')
