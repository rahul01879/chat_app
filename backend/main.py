import os
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Set, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId


app = FastAPI(title="Encrypted Chat API", version="1.2.0")


# =========================
# Config
# =========================
ROOM_TTL_HOURS = int(os.getenv("ROOM_TTL_HOURS", "2"))  # 2 hours
MESSAGE_TTL_SECONDS = ROOM_TTL_HOURS * 60 * 60
SELF_DESTRUCT_SECONDS_DEFAULT = int(os.getenv("SELF_DESTRUCT_SECONDS", "60"))  # 1 minute

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "secure_chat")

# ✅ Parse allowed origins from env (comma-separated)
# Example:
# ALLOWED_ORIGINS=https://chat-app-green-five-45.vercel.app,https://localhost,http://localhost
env_origins = os.getenv("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in env_origins.split(",") if o.strip()]

# ✅ Add safe defaults (dev + Capacitor)
DEFAULT_ORIGINS = [
    "https://chat-app-green-five-45.vercel.app",  # your Vercel
    "https://localhost",  # Capacitor Android WebView origin (common)
    "http://localhost",   # fallback
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
    "http://localhost:3000",
]

FINAL_ORIGINS = sorted(set(ALLOWED_ORIGINS + DEFAULT_ORIGINS))

print(f"🌍 ALLOWED_ORIGINS (final): {FINAL_ORIGINS}")
print(f"🗄️ MongoDB: {MONGO_URI[:35]}..." if len(MONGO_URI) > 35 else MONGO_URI)
print(f"🗄️ DB_NAME: {DB_NAME}")

# ✅ CORS (must include Capacitor origin, otherwise APK fetch() fails)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FINAL_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)
# FastAPI CORSMiddleware requires explicitly listing allowed origins when using credentials. [web:85]


mongo_client: Optional[AsyncIOMotorClient] = None
db = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


class ConnectionManager:
    def __init__(self):
        self.active_rooms: Dict[str, Set[WebSocket]] = {}
        self.room_created_at: Dict[str, datetime] = {}
        self.user_names: Dict[WebSocket, str] = {}
        self._self_destruct_tasks: Dict[str, asyncio.Task] = {}  # message_id -> Task

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()

        if room_id not in self.active_rooms:
            self.active_rooms[room_id] = set()
            self.room_created_at[room_id] = utc_now()

            if db:
                try:
                    now = utc_now()
                    await db.rooms.update_one(
                        {"room_id": room_id},
                        {"$set": {
                            "room_id": room_id,
                            "created_at": now,
                            "expires_at": now + timedelta(hours=ROOM_TTL_HOURS),
                            "active": True,
                        }},
                        upsert=True,
                    )
                except Exception as e:
                    print(f"❌ Error creating room: {e}")

        self.active_rooms[room_id].add(websocket)

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_rooms:
            self.active_rooms[room_id].discard(websocket)

            if websocket in self.user_names:
                del self.user_names[websocket]

            if len(self.active_rooms[room_id]) == 0:
                del self.active_rooms[room_id]
                self.room_created_at.pop(room_id, None)

    async def broadcast(self, message: dict, room_id: str, exclude: WebSocket = None):
        if room_id not in self.active_rooms:
            return

        disconnected = set()
        for connection in self.active_rooms[room_id]:
            if connection == exclude:
                continue
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"❌ Error broadcasting: {e}")
                disconnected.add(connection)

        for conn in disconnected:
            self.disconnect(conn, room_id)

    async def cleanup_old_rooms(self):
        while True:
            try:
                await asyncio.sleep(300)
                if not db:
                    continue

                current_time = utc_now()
                expired_rooms = await db.rooms.find(
                    {"expires_at": {"$lt": current_time}, "active": True}
                ).to_list(length=200)

                for room in expired_rooms:
                    room_id = room["room_id"]
                    print(f"🧹 Expiring room: {room_id}")

                    await db.rooms.update_one(
                        {"room_id": room_id},
                        {"$set": {"active": False}},
                    )

                    res = await db.messages.delete_many({"room_id": room_id})
                    print(f"   Deleted {res.deleted_count} messages")

                    if room_id in self.active_rooms:
                        await self.broadcast(
                            {
                                "type": "room_expired",
                                "message": f"⏰ This room has expired after {ROOM_TTL_HOURS} hours",
                                "timestamp": utc_iso(utc_now()),
                            },
                            room_id,
                        )
                        for conn in list(self.active_rooms[room_id]):
                            try:
                                await conn.close()
                            except Exception:
                                pass

                        del self.active_rooms[room_id]
                        self.room_created_at.pop(room_id, None)

            except Exception as e:
                print(f"❌ Cleanup task error: {e}")

    async def schedule_self_destruct(self, message_id: str, room_id: str, seconds: int):
        try:
            await asyncio.sleep(max(1, int(seconds)))

            if not db:
                return

            # ✅ _id is ObjectId in Mongo, convert from string
            res = await db.messages.delete_one({"_id": ObjectId(message_id)})
            if res.deleted_count:
                await self.broadcast(
                    {
                        "type": "message_deleted",
                        "message_id": message_id,
                        "room_id": room_id,
                        "timestamp": utc_iso(utc_now()),
                    },
                    room_id,
                )
        except Exception as e:
            print(f"❌ Self-destruct task error: {e}")
        finally:
            self._self_destruct_tasks.pop(message_id, None)


manager = ConnectionManager()


@app.on_event("startup")
async def startup_event():
    global mongo_client, db
    try:
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        db = mongo_client[DB_NAME]

        await db.command("ping")
        print("✅ Connected to MongoDB")

        await db.rooms.create_index("room_id", unique=True)
        await db.rooms.create_index("expires_at")
        await db.rooms.create_index([("active", 1), ("expires_at", 1)])
        await db.messages.create_index([("room_id", 1), ("timestamp", -1)])

        # TTL for messages (2h)
        existing_indexes = await db.messages.index_information()
        ttl_index_name = None
        for name, info in existing_indexes.items():
            if info.get("key") == [("timestamp", 1)] and "expireAfterSeconds" in info:
                ttl_index_name = name
                break

        if ttl_index_name:
            old = existing_indexes[ttl_index_name].get("expireAfterSeconds")
            if old != MESSAGE_TTL_SECONDS:
                print(f"🛠️ Updating TTL index {old}s -> {MESSAGE_TTL_SECONDS}s (drop+recreate)")
                await db.messages.drop_index(ttl_index_name)
                await db.messages.create_index("timestamp", expireAfterSeconds=MESSAGE_TTL_SECONDS)
        else:
            await db.messages.create_index("timestamp", expireAfterSeconds=MESSAGE_TTL_SECONDS)

        asyncio.create_task(manager.cleanup_old_rooms())
        print("✅ Background cleanup task started")

    except Exception as e:
        print(f"❌ Startup error: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    if mongo_client:
        mongo_client.close()
        print("✅ MongoDB connection closed")


@app.get("/")
async def root():
    return {
        "message": "Encrypted Chat API",
        "status": "running",
        "version": app.version,
        "active_rooms": len(manager.active_rooms),
        "room_ttl_hours": ROOM_TTL_HOURS,
    }


@app.get("/health")
async def health_check():
    db_status = "disconnected"
    try:
        if db:
            await db.command("ping")
            db_status = "connected"
    except Exception:
        pass

    return {
        "status": "healthy",
        "database": db_status,
        "active_rooms": len(manager.active_rooms),
        "timestamp": utc_iso(utc_now()),
    }


@app.get("/room/{room_id}/info")
async def get_room_info(room_id: str):
    try:
        if not db:
            return {"exists": False, "error": "DB not ready"}

        room = await db.rooms.find_one({"room_id": room_id, "active": True})
        if room:
            if room["expires_at"] < utc_now():
                await db.rooms.update_one({"room_id": room_id}, {"$set": {"active": False}})
                return {"exists": False, "room_id": room_id}

            return {
                "exists": True,
                "room_id": room_id,
                "created_at": utc_iso(room["created_at"]),
                "expires_at": utc_iso(room["expires_at"]),
                "active_users": len(manager.active_rooms.get(room_id, set())),
                "time_remaining": str(room["expires_at"] - utc_now()),
            }

        return {"exists": False, "room_id": room_id}
    except Exception as e:
        print(f"❌ Error fetching room info: {e}")
        return {"exists": False, "error": str(e)}


@app.get("/room/{room_id}/history")
async def get_room_history(room_id: str):
    try:
        if not db:
            return {"messages": [], "error": "DB not ready"}

        room = await db.rooms.find_one({"room_id": room_id, "active": True})
        if not room:
            return {"messages": []}

        messages = await db.messages.find({"room_id": room_id}).sort("timestamp", 1).limit(100).to_list(length=100)

        return {
            "messages": [
                {
                    "id": str(msg.get("_id")),
                    "username": msg.get("username", "Anonymous"),
                    "encrypted_data": msg.get("encrypted_data", {}),
                    "timestamp": utc_iso(msg["timestamp"]),
                    "selfDestruct": msg.get("selfDestruct", False),
                    "destructTime": msg.get("destructTime"),
                }
                for msg in messages
                if "encrypted_data" in msg and msg["encrypted_data"]
            ]
        }
    except Exception as e:
        print(f"❌ Error fetching history: {e}")
        return {"messages": [], "error": str(e)}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)
    current_username = "Anonymous"

    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            message_type = message_data.get("type")

            if message_type == "join":
                current_username = message_data.get("username", "Anonymous")
                manager.user_names[websocket] = current_username

                await manager.broadcast(
                    {
                        "type": "user_joined",
                        "username": current_username,
                        "message": f"👋 {current_username} joined the room",
                        "timestamp": utc_iso(utc_now()),
                    },
                    room_id,
                )

            elif message_type == "user_leaving":
                username = message_data.get("username", current_username)
                await manager.broadcast(
                    {
                        "type": "user_left",
                        "username": username,
                        "message": f"👋 {username} left the room",
                        "timestamp": utc_iso(utc_now()),
                    },
                    room_id,
                )

            elif message_type == "typing":
                await manager.broadcast(
                    {
                        "type": "typing",
                        "username": message_data.get("username", current_username),
                        "isTyping": message_data.get("isTyping", False),
                    },
                    room_id,
                    exclude=websocket,
                )

            elif message_type == "reaction":
                await manager.broadcast(
                    {
                        "type": "reaction",
                        "messageIndex": message_data.get("messageIndex"),
                        "emoji": message_data.get("emoji"),
                        "username": message_data.get("username", current_username),
                    },
                    room_id,
                )

            elif message_type == "message":
                encrypted_data = message_data.get("data", {})
                if not encrypted_data or not isinstance(encrypted_data, dict):
                    continue
                if "encrypted" not in encrypted_data or "iv" not in encrypted_data:
                    continue

                now = utc_now()

                self_destruct = bool(message_data.get("selfDestruct", False))
                destruct_time = message_data.get("destructTime")

                if self_destruct:
                    seconds = int(destruct_time) if destruct_time else SELF_DESTRUCT_SECONDS_DEFAULT
                    seconds = max(5, min(seconds, 600))
                    destruct_at = now + timedelta(seconds=seconds)
                else:
                    seconds = None
                    destruct_at = None

                message_doc = {
                    "room_id": room_id,
                    "username": message_data.get("username", current_username),
                    "encrypted_data": encrypted_data,
                    "timestamp": now,
                    "selfDestruct": self_destruct,
                    "destructTime": seconds,
                    "destructAt": destruct_at,
                }

                inserted_id = None
                if db:
                    try:
                        res = await db.messages.insert_one(message_doc)
                        inserted_id = str(res.inserted_id)
                    except Exception as e:
                        print(f"❌ Error saving message: {e}")

                await manager.broadcast(
                    {
                        "type": "message",
                        "data": encrypted_data,
                        "username": message_data.get("username", current_username),
                        "timestamp": utc_iso(now),
                        "selfDestruct": self_destruct,
                        "destructTime": seconds,
                        "message_id": inserted_id,
                    },
                    room_id,
                )

                if self_destruct and inserted_id:
                    t = asyncio.create_task(manager.schedule_self_destruct(inserted_id, room_id, seconds))
                    manager._self_destruct_tasks[inserted_id] = t

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        if current_username != "Anonymous":
            await manager.broadcast(
                {
                    "type": "user_left",
                    "username": current_username,
                    "message": f"👋 {current_username} left the room",
                    "timestamp": utc_iso(utc_now()),
                },
                room_id,
            )
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        manager.disconnect(websocket, room_id)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info", access_log=True)
