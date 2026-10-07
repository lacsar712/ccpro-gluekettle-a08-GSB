from datetime import date, datetime, timezone
from typing import ClassVar, Optional

from sqlalchemy import Index, text
from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str
    role: str = "worker"


class Workshop(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    alley: str = ""
    kettles: list["Kettle"] = Relationship(back_populates="workshop")


class Kettle(SQLModel, table=True):
    STATUS_COLD: ClassVar[str] = "cold"
    STATUS_BOILING: ClassVar[str] = "boiling"
    STATUS_DRAWN: ClassVar[str] = "drawn"

    id: Optional[int] = Field(default=None, primary_key=True)
    workshop_id: int = Field(foreign_key="workshop.id")
    code: str
    status: str = STATUS_COLD
    bench: int = 0
    workshop: Optional[Workshop] = Relationship(back_populates="kettles")
    cooks: list["CookLog"] = Relationship(back_populates="kettle")


class CookLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kettle_id: int = Field(foreign_key="kettle.id")
    taken_at: datetime = Field(default_factory=utcnow)
    peak_temp_c: float
    operator: str = ""
    kettle: Optional[Kettle] = Relationship(back_populates="cooks")


class GateCert(SQLModel, table=True):
    """闸板证：同坊同日最多一张有效证（未作废），由部分唯一索引兜底。"""

    __tablename__ = "gatecert"
    __table_args__ = (
        Index(
            "uq_gatecert_one_valid_per_day",
            "workshop_id",
            "patrol_date",
            unique=True,
            postgresql_where=text("voided_at IS NULL"),
            sqlite_where=text("voided_at IS NULL"),
        ),
    )

    GATE_OPEN: ClassVar[str] = "open"
    GATE_CLOSED: ClassVar[str] = "closed"

    id: Optional[int] = Field(default=None, primary_key=True)
    workshop_id: int = Field(foreign_key="workshop.id")
    patrol_date: date
    gate: str = GATE_CLOSED
    patroller: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    voided_at: Optional[datetime] = None
