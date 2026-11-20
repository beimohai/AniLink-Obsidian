import importlib.util
from pathlib import Path
import unittest
import json
import numpy as np

spec = importlib.util.spec_from_file_location('align_audio', Path(__file__).parents[1] / 'scripts' / 'align-audio.py')
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


class OpeningAlignmentTests(unittest.TestCase):
    def test_unrelated_trailing_video_does_not_affect_alignment(self):
        rate = 2000
        rng = np.random.default_rng(123)
        opening = rng.normal(size=180 * rate)
        target = np.concatenate([np.zeros(rate), opening])
        first = alignment.align_spectral(opening, target)
        extended = alignment.align_spectral(
            np.concatenate([opening, rng.normal(size=120 * rate)]),
            np.concatenate([target, rng.normal(size=90 * rate)]),
        )
        json.dumps(first)
        json.dumps(extended)
        self.assertIsInstance(first['retried'], bool)
        self.assertAlmostEqual(first['offsetSeconds'], 1.0, places=2)
        self.assertEqual(first, extended)
        self.assertTrue(all(anchor['source'] + 8 <= 180 and anchor['target'] + 8 <= 180 for anchor in extended['anchors']))

    def test_an_unmatched_opening_sample_triggers_retry(self):
        rate = 2000
        rng = np.random.default_rng(789)
        source = rng.normal(size=180 * rate)
        target = source.copy()
        target[80 * rate:100 * rate] = rng.normal(size=20 * rate)
        result = alignment.align_spectral(source, target)
        self.assertTrue(result['retried'])
        self.assertEqual(len(result['anchors']) + len(result['rejectedAnchors']), 6)
        self.assertGreaterEqual(len(result['anchors']), 3)
        self.assertAlmostEqual(result['offsetSeconds'], 0, places=2)

    def test_short_opening_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '24 seconds'):
            alignment.align_spectral(np.ones(2000), np.ones(2000))

    def test_unrelated_openings_are_rejected(self):
        rng = np.random.default_rng(456)
        with self.assertRaisesRegex(ValueError, 'confidence'):
            alignment.align_spectral(rng.normal(size=60 * 2000), rng.normal(size=60 * 2000))


if __name__ == '__main__':
    unittest.main()
