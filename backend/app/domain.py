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


def assert_gate_open(gate_cert: GateCert | None) -> None:
    if gate_cert is None:
        raise RuleError("当日无闸板证，熬煮中不能拨回冷锅")
    if gate_cert.gate != GateCert.GATE_OPEN:
        raise RuleError("当日闸板证为关闸，熬煮中不能拨回冷锅")


def assert_can_set_status(
    kettle: Kettle, new_status: str, gate_cert: GateCert | None = None
) -> None:
    allowed = {Kettle.STATUS_COLD, Kettle.STATUS_BOILING, Kettle.STATUS_DRAWN}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    # 仅「熬煮中 → 冷锅」读闸板证；已出胶、登记峰值等一律不拦。
    if kettle.status == Kettle.STATUS_BOILING and new_status == Kettle.STATUS_COLD:
        assert_gate_open(gate_cert)
    if new_status != Kettle.STATUS_DRAWN:
        return
    peak = latest_peak(kettle)
    if peak is None:
        raise RuleError("该锅尚无煮胶峰值，不能出胶")
    if peak < MIN_PEAK:
        raise RuleError(f"最近峰值 {peak}℃ 低于 {MIN_PEAK:.0f}℃，不能出胶")
