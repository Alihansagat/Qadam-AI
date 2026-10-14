import unittest
from datetime import date, timedelta
import numpy as np
from train import features, fit_predict, train

class TemporalTests(unittest.TestCase):
    def test_features_have_only_prior_sales(self):
        values = list(range(14))
        self.assertEqual(features(values,date(2026,1,1))[:5], [13,7,0,10,6.5])

    def test_constant_and_zero_series_are_supported(self):
        dates = [date(2026,1,1)+timedelta(days=i) for i in range(40)]
        for method in ['catboost','lightgbm']:
            for value in [0,10]:
                p = fit_predict([value]*40,dates,30,method)
                np.testing.assert_allclose(p,[value]*30,atol=1e-6)

    def test_test_labels_cannot_change_validation_or_test_predictions(self):
        rows=[{'sku':'A','date':(date(2026,1,1)+timedelta(days=i)).isoformat(),'units':5+i%7} for i in range(70)]
        a=train({'rows':rows,'fingerprint':'test','source':'test'})['products']['A']
        changed=[dict(r,units=r['units']+(100 if i>=56 else 0)) for i,r in enumerate(rows)]
        b=train({'rows':changed,'fingerprint':'test','source':'test'})['products']['A']
        for method in ['catboost','lightgbm']:
            self.assertEqual(a['models'][method]['validation'],b['models'][method]['validation'])
            self.assertEqual(a['models'][method]['test'],b['models'][method]['test'])
            self.assertNotEqual(a['models'][method]['forecast'],b['models'][method]['forecast'])

if __name__=='__main__': unittest.main()
