from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from sqlmodel import SQLModel, select

from app.db import engine, get_session
from app.domain import RuleError, assert_can_set_status, assert_gate_open, latest_peak, needs_gate_cert
from app.models import CookLog, GateCert, Kettle, User, Workshop, utcnow
from app.security import make_token, parse_token, verify_password
from app.seed import seed_demo


async def current_user(request: Request) -> User | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    username = parse_token(header.split(" ", 1)[1])
    if not username:
        return None
    with get_session() as session:
        return session.exec(select(User).where(User.username == username)).first()


def load_kettle(session, kettle_id: int) -> Kettle | None:
    return session.exec(
        select(Kettle).where(Kettle.id == kettle_id).options(selectinload(Kettle.cooks))
    ).first()


def kettle_json(kettle: Kettle) -> dict:
    return {
        "id": kettle.id,
        "code": kettle.code,
        "status": kettle.status,
        "bench": kettle.bench,
        "latestPeakC": latest_peak(kettle),
        "cookCount": len(kettle.cooks or []),
    }


def cert_json(cert: GateCert) -> dict:
    return {
        "id": cert.id,
        "workshopId": cert.workshop_id,
        "patrolDate": cert.patrol_date.isoformat(),
        "gate": cert.gate,
        "patroller": cert.patroller,
        "createdAt": cert.created_at.isoformat() if cert.created_at else None,
        "voidedAt": cert.voided_at.isoformat() if cert.voided_at else None,
    }


def valid_cert_on(session, workshop_id: int, day: date) -> GateCert | None:
    return session.exec(
        select(GateCert).where(
            GateCert.workshop_id == workshop_id,
            GateCert.patrol_date == day,
            GateCert.voided_at.is_(None),
        )
    ).first()


async def health(request: Request):
    return JSONResponse({"status": "ok", "service": "GlueKettle"})


async def login(request: Request):
    body = await request.json()
    with get_session() as session:
        user = session.exec(select(User).where(User.username == body.get("username", ""))).first()
        if user is None or not verify_password(body.get("password", ""), user.password_hash):
            return JSONResponse({"detail": "用户名或密码错误"}, status_code=401)
        return JSONResponse(
            {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}
        )


async def me(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    return JSONResponse({"username": user.username, "role": user.role})


async def board(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    with get_session() as session:
        shop = session.exec(select(Workshop)).first()
        if shop is None:
            return JSONResponse({"detail": "尚无熬胶坊"}, status_code=404)
        kettles = session.exec(
            select(Kettle)
            .where(Kettle.workshop_id == shop.id)
            .options(selectinload(Kettle.cooks))
        ).all()
        loaded = sorted(kettles, key=lambda k: k.bench)
        return JSONResponse(
            {"workshop": shop.name, "alley": shop.alley, "kettles": [kettle_json(k) for k in loaded]}
        )


async def add_cook(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    kettle_id = int(request.path_params["kettle_id"])
    body = await request.json()
    try:
        peak = float(body.get("peakTempC"))
    except (TypeError, ValueError):
        return JSONResponse({"detail": "峰值温度必须是数字"}, status_code=400)
    with get_session() as session:
        kettle = load_kettle(session, kettle_id)
        if kettle is None:
            return JSONResponse({"detail": "锅不存在"}, status_code=404)
        session.add(CookLog(kettle_id=kettle.id, peak_temp_c=peak, operator=user.username))
        session.commit()
        kettle = load_kettle(session, kettle_id)
        return JSONResponse(kettle_json(kettle))


async def set_status(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    kettle_id = int(request.path_params["kettle_id"])
    body = await request.json()
    new_status = body.get("status", "")
    with get_session() as session:
        kettle = load_kettle(session, kettle_id)
        if kettle is None:
            return JSONResponse({"detail": "锅不存在"}, status_code=404)
        try:
            assert_can_set_status(kettle, new_status)
            if needs_gate_cert(kettle, new_status):
                assert_gate_open(valid_cert_on(session, kettle.workshop_id, date.today()))
        except RuleError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=400)
        kettle.status = new_status
        session.add(kettle)
        session.commit()
        kettle = load_kettle(session, kettle_id)
        return JSONResponse(kettle_json(kettle))


async def list_gate_certs(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    day = request.query_params.get("day", "").strip()
    gate = request.query_params.get("gate", "").strip()
    cert_state = request.query_params.get("state", "").strip()
    with get_session() as session:
        shop = session.exec(select(Workshop)).first()
        if shop is None:
            return JSONResponse({"detail": "尚无熬胶坊"}, status_code=404)
        q = select(GateCert).where(GateCert.workshop_id == shop.id)
        if day:
            try:
                q = q.where(GateCert.patrol_date == date.fromisoformat(day))
            except ValueError:
                return JSONResponse({"detail": "巡沟日格式应为 YYYY-MM-DD"}, status_code=400)
        if gate:
            if gate not in (GateCert.GATE_OPEN, GateCert.GATE_CLOSED):
                return JSONResponse({"detail": "闸板取值只能是 open/closed"}, status_code=400)
            q = q.where(GateCert.gate == gate)
        if cert_state == "valid":
            q = q.where(GateCert.voided_at.is_(None))
        elif cert_state == "voided":
            q = q.where(GateCert.voided_at.isnot(None))
        elif cert_state:
            return JSONResponse({"detail": "状态取值只能是 valid/voided"}, status_code=400)
        certs = session.exec(q.order_by(GateCert.patrol_date.desc(), GateCert.id.desc())).all()
        return JSONResponse({"workshop": shop.name, "certs": [cert_json(c) for c in certs]})


async def create_gate_cert(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    if user.role != "admin":
        return JSONResponse({"detail": "仅管理员可巡沟开证"}, status_code=403)
    body = await request.json()
    try:
        day = date.fromisoformat(str(body.get("day", "")))
    except ValueError:
        return JSONResponse({"detail": "巡沟日格式应为 YYYY-MM-DD"}, status_code=400)
    gate = body.get("gate", "")
    if gate not in (GateCert.GATE_OPEN, GateCert.GATE_CLOSED):
        return JSONResponse({"detail": "闸板取值只能是开闸或关闸"}, status_code=400)
    with get_session() as session:
        shop = session.exec(select(Workshop)).first()
        if shop is None:
            return JSONResponse({"detail": "尚无熬胶坊"}, status_code=404)
        if valid_cert_on(session, shop.id, day) is not None:
            return JSONResponse({"detail": "该坊当日已有有效闸板证，须先作废再开"}, status_code=409)
        cert = GateCert(workshop_id=shop.id, patrol_date=day, gate=gate, patroller=user.username)
        session.add(cert)
        try:
            session.commit()
        except IntegrityError:
            # 并发双开：部分唯一索引只放行一张，后到者落这里
            session.rollback()
            return JSONResponse({"detail": "该坊当日已有有效闸板证，须先作废再开"}, status_code=409)
        session.refresh(cert)
        return JSONResponse(cert_json(cert), status_code=201)


async def void_gate_cert(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"detail": "未登录"}, status_code=401)
    if user.role != "admin":
        return JSONResponse({"detail": "仅管理员可作废闸板证"}, status_code=403)
    cert_id = int(request.path_params["cert_id"])
    with get_session() as session:
        cert = session.get(GateCert, cert_id)
        if cert is None:
            return JSONResponse({"detail": "闸板证不存在"}, status_code=404)
        if cert.voided_at is not None:
            return JSONResponse({"detail": "该证已作废"}, status_code=400)
        cert.voided_at = utcnow()
        session.add(cert)
        session.commit()
        session.refresh(cert)
        return JSONResponse(cert_json(cert))


def init() -> None:
    SQLModel.metadata.create_all(engine)
    seed_demo()


init()

app = Starlette(
    routes=[
        Route("/api/health", health),
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/me", me),
        Route("/api/board", board),
        Route("/api/kettles/{kettle_id:int}/cooks", add_cook, methods=["POST"]),
        Route("/api/kettles/{kettle_id:int}/status", set_status, methods=["POST"]),
        Route("/api/gate-certs", list_gate_certs),
        Route("/api/gate-certs", create_gate_cert, methods=["POST"]),
        Route("/api/gate-certs/{cert_id:int}/void", void_gate_cert, methods=["POST"]),
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])],
)
