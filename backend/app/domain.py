"""熬锅门槛：出胶看最近峰值；熬煮中拨回冷锅看当日闸板证。"""

from app.models import GateCert, Kettle

MIN_PEAK = 90.0


class RuleError(ValueError):
    pass


def latest_peak(kettle: Kettle) -> float | None:
    if not kettle.cooks:
        return None
    latest = max(kettle.cooks, key=lambda c: c.taken_at)
    return latest.peak_temp_c


def assert_can_set_status(kettle: Kettle, new_status: str) -> None:
    allowed = {Kettle.STATUS_COLD, Kettle.STATUS_BOILING, Kettle.STATUS_DRAWN}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Kettle.STATUS_DRAWN:
        return
    peak = latest_peak(kettle)
    if peak is None:
        raise RuleError("该锅尚无煮胶峰值，不能出胶")
    if peak < MIN_PEAK:
        raise RuleError(f"最近峰值 {peak}℃ 低于 {MIN_PEAK:.0f}℃，不能出胶")


def needs_gate_cert(kettle: Kettle, new_status: str) -> bool:
    """仅「熬煮中 → 冷锅」要验当日闸板证。

    已出胶拨冷锅、登记峰值、出胶本身都不读闸板证。"""
    return kettle.status == Kettle.STATUS_BOILING and new_status == Kettle.STATUS_COLD


def assert_gate_open(cert: GateCert | None) -> None:
    if cert is None:
        raise RuleError("当日尚无有效开闸证，熬煮中不能拨回冷锅")
    if cert.gate != GateCert.GATE_OPEN:
        raise RuleError("当日闸板证写着关闸，熬煮中不能拨回冷锅")
