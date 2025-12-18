import unittest

from src.progress_tracker import ProgressOperation, progress_tracker


class ProgressTrackerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Reset state between tests
        progress_tracker._state.clear()  # pylint: disable=protected-access

    async def test_start_advance_finish(self):
        await progress_tracker.start(ProgressOperation.REFRESH_EMAILS, total=3, message="begin")
        state = await progress_tracker.get(ProgressOperation.REFRESH_EMAILS)
        self.assertEqual(state.status, "running")
        self.assertEqual(state.total, 3)
        self.assertEqual(state.processed, 0)
        self.assertEqual(state.message, "begin")

        await progress_tracker.advance(ProgressOperation.REFRESH_EMAILS, message="step1")
        state = await progress_tracker.get(ProgressOperation.REFRESH_EMAILS)
        self.assertEqual(state.processed, 1)
        self.assertEqual(state.message, "step1")

        await progress_tracker.advance(ProgressOperation.REFRESH_EMAILS, step=10)
        state = await progress_tracker.get(ProgressOperation.REFRESH_EMAILS)
        self.assertEqual(state.processed, 3)  # should clamp to total

        await progress_tracker.finish(ProgressOperation.REFRESH_EMAILS, message="done")
        state = await progress_tracker.get(ProgressOperation.REFRESH_EMAILS)
        self.assertEqual(state.status, "completed")
        self.assertEqual(state.message, "done")

    async def test_fail_sets_error_state(self):
        await progress_tracker.start(ProgressOperation.HEALTH_CHECK, total=1)
        await progress_tracker.fail(ProgressOperation.HEALTH_CHECK, error="boom")

        state = await progress_tracker.get(ProgressOperation.HEALTH_CHECK)
        self.assertEqual(state.status, "error")
        self.assertEqual(state.error, "boom")
        self.assertEqual(state.message, "boom")

    async def test_snapshot_returns_default_for_unknown(self):
        snapshot = await progress_tracker.snapshot(["unknown_op"])
        state = snapshot.get("unknown_op")
        self.assertIsNotNone(state)
        self.assertEqual(state.status, "idle")
        self.assertEqual(state.total, 0)
        self.assertEqual(state.processed, 0)
        self.assertEqual(state.message, "")


if __name__ == "__main__":
    unittest.main()
