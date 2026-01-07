import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from typing import Dict, Set, Optional
import asyncio
import json
from motor.motor_asyncio import AsyncIOMotorClient

app = FastAPI(title="Encrypted Chat API", version="1.0.0")

# ✅ Get allowed origins from environment variable
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else []

print(f"🌍 Loaded ALLOWED_ORIGINS: {ALLOWED_ORIGINS}")

# ✅ CORS Configuration for production + development
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS + [
        "http://localhost:5173",        # Vite dev server
        "http://localhost:4173",        # Vite preview server
        "http://127.0.0.1:5173",       # Alternative localhost
        "http://127.0.0.1:4173",
        "http://localhost:3000",        # Alternative port
        "https://*.vercel.app",         # All Vercel preview deployments
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# ✅ MongoDB Configuration from environment
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "secure_chat")

print(f"🗄️  MongoDB URI: {MONGO_URI[:30]}..." if len(MONGO_URI) > 30 else MONGO_URI)
print(f"🗄️  Database Name: {DB_NAME}")

# MongoDB Client
mongo_client: Optional[AsyncIOMotorClient] = None
db = None

class ConnectionManager:
    def __init__(self):
        self.active_rooms: Dict[str, Set[WebSocket]] = {}
        self.room_created_at: Dict[str, datetime] = {}
        self.user_names: Dict[WebSocket, str] = {}  # Track usernames
        
    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        
        if room_id not in self.active_rooms:
            self.active_rooms[room_id] = set()
            self.room_created_at[room_id] = datetime.utcnow()
            
            # Create room in database
            try:
                await db.rooms.update_one(
                    {"room_id": room_id},
                    {
                        "$set": {
                            "room_id": room_id,
                            "created_at": datetime.utcnow(),
                            "expires_at": datetime.utcnow() + timedelta(hours=3),
                            "active": True
                        }
                    },
                    upsert=True
                )
            except Exception as e:
                print(f"Error creating room: {e}")
        
        self.active_rooms[room_id].add(websocket)
        
    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_rooms:
            self.active_rooms[room_id].discard(websocket)
            
            # Remove username tracking
            if websocket in self.user_names:
                del self.user_names[websocket]
            
            # Clean up empty rooms
            if len(self.active_rooms[room_id]) == 0:
                del self.active_rooms[room_id]
                if room_id in self.room_created_at:
                    del self.room_created_at[room_id]
    
    async def broadcast(self, message: dict, room_id: str, exclude: WebSocket = None):
        """Broadcast message to all connections in a room"""
        if room_id not in self.active_rooms:
            return
            
        disconnected = set()
        for connection in self.active_rooms[room_id]:
            if connection != exclude:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    print(f"Error broadcasting to connection: {e}")
                    disconnected.add(connection)
        
        # Clean up disconnected websockets
        for conn in disconnected:
            self.disconnect(conn, room_id)
    
    async def cleanup_old_rooms(self):
        """Background task to cleanup expired rooms"""
        while True:
            try:
                await asyncio.sleep(300)  # Check every 5 minutes
                current_time = datetime.utcnow()
                
                # Check database for expired rooms
                expired_rooms = await db.rooms.find({
                    "expires_at": {"$lt": current_time},
                    "active": True
                }).to_list(length=100)
                
                for room in expired_rooms:
                    room_id = room["room_id"]
                    
                    print(f"🧹 Cleaning up expired room: {room_id}")
                    
                    # Mark room as inactive
                    await db.rooms.update_one(
                        {"room_id": room_id},
                        {"$set": {"active": False}}
                    )
                    
                    # Delete messages (for privacy)
                    result = await db.messages.delete_many({"room_id": room_id})
                    print(f"  Deleted {result.deleted_count} messages")
                    
                    # Notify active users
                    if room_id in self.active_rooms:
                        await self.broadcast({
                            "type": "room_expired",
                            "message": "⏰ This room has expired after 3 hours"
                        }, room_id)
                        
                        # Close all connections
                        for conn in list(self.active_rooms[room_id]):
                            try:
                                await conn.close()
                            except:
                                pass
                        
                        # Clean up from memory
                        del self.active_rooms[room_id]
                        if room_id in self.room_created_at:
                            del self.room_created_at[room_id]
                            
            except Exception as e:
                print(f"❌ Error in cleanup task: {e}")

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    """Initialize database and start background tasks"""
    global mongo_client, db
    
    try:
        # Initialize MongoDB
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        db = mongo_client[DB_NAME]
        
        # Test connection
        await db.command('ping')
        print("✅ Connected to MongoDB")
        
        # Create indexes
        await db.rooms.create_index("room_id", unique=True)
        await db.rooms.create_index("expires_at")
        await db.rooms.create_index([("active", 1), ("expires_at", 1)])
        await db.messages.create_index([("room_id", 1), ("timestamp", -1)])
        await db.messages.create_index("timestamp", expireAfterSeconds=10800)  # Auto-delete after 3 hours
        print("✅ Database indexes created")
        
        # Start cleanup task
        asyncio.create_task(manager.cleanup_old_rooms())
        print("✅ Background cleanup task started")
        print(f"🚀 Server ready! Active rooms: {len(manager.active_rooms)}")
        
    except Exception as e:
        print(f"❌ Startup error: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean shutdown"""
    if mongo_client:
        mongo_client.close()
        print("✅ MongoDB connection closed")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Encrypted Chat API",
        "status": "running",
        "version": "1.0.0",
        "active_rooms": len(manager.active_rooms)
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    try:
        # Check MongoDB connection
        await db.command('ping')
        db_status = "connected"
    except:
        db_status = "disconnected"
    
    return {
        "status": "healthy",
        "database": db_status,
        "active_rooms": len(manager.active_rooms),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/room/{room_id}/info")
async def get_room_info(room_id: str):
    """Get room information"""
    try:
        room = await db.rooms.find_one({"room_id": room_id, "active": True})
        
        if room:
            # Check if room has expired
            if room["expires_at"] < datetime.utcnow():
                await db.rooms.update_one(
                    {"room_id": room_id},
                    {"$set": {"active": False}}
                )
                return {"exists": False}
            
            return {
                "exists": True,
                "room_id": room_id,
                "created_at": room["created_at"].isoformat(),
                "expires_at": room["expires_at"].isoformat(),
                "active_users": len(manager.active_rooms.get(room_id, set())),
                "time_remaining": str(room["expires_at"] - datetime.utcnow())
            }
        
        return {"exists": False, "room_id": room_id}
        
    except Exception as e:
        print(f"❌ Error fetching room info: {e}")
        return {"exists": False, "error": str(e)}

@app.get("/room/{room_id}/history")
async def get_room_history(room_id: str):
    """Get encrypted message history for a room"""
    try:
        # Verify room exists and is active
        room = await db.rooms.find_one({"room_id": room_id, "active": True})
        if not room:
            return {"messages": []}
        
        # Fetch messages
        messages = await db.messages.find(
            {"room_id": room_id}
        ).sort("timestamp", 1).limit(100).to_list(length=100)
        
        return {
            "messages": [
                {
                    "username": msg.get("username", "Anonymous"),
                    "encrypted_data": msg.get("encrypted_data", {}),
                    "timestamp": msg["timestamp"].isoformat(),
                    "selfDestruct": msg.get("selfDestruct", False),
                    "destructTime": msg.get("destructTime")
                }
                for msg in messages
                if "encrypted_data" in msg and msg["encrypted_data"]
            ]
        }
        
    except Exception as e:
        print(f"❌ Error fetching history: {e}")
        return {"messages": [], "error": str(e)}

@app.delete("/admin/cleanup")
async def cleanup_database():
    """Admin endpoint to clean database (protect this in production!)"""
    try:
        messages_deleted = await db.messages.delete_many({})
        rooms_deleted = await db.rooms.delete_many({})
        
        return {
            "status": "success",
            "messages_deleted": messages_deleted.deleted_count,
            "rooms_deleted": rooms_deleted.deleted_count
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """WebSocket endpoint for real-time chat"""
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
                
                await manager.broadcast({
                    "type": "user_joined",
                    "username": current_username,
                    "message": f"👋 {current_username} joined the room",
                    "timestamp": datetime.utcnow().isoformat()
                }, room_id)
                
            elif message_type == "user_leaving":
                username = message_data.get("username", current_username)
                await manager.broadcast({
                    "type": "user_left",
                    "username": username,
                    "message": f"👋 {username} left the room",
                    "timestamp": datetime.utcnow().isoformat()
                }, room_id)
                
            elif message_type == "typing":
                await manager.broadcast({
                    "type": "typing",
                    "username": message_data.get("username", current_username),
                    "isTyping": message_data.get("isTyping", False)
                }, room_id, exclude=websocket)
                
            elif message_type == "reaction":
                await manager.broadcast({
                    "type": "reaction",
                    "messageIndex": message_data.get("messageIndex"),
                    "emoji": message_data.get("emoji"),
                    "username": message_data.get("username", current_username)
                }, room_id)
                
            elif message_type == "message":
                # Validate encrypted data
                encrypted_data = message_data.get("data", {})
                if not encrypted_data or not isinstance(encrypted_data, dict):
                    print("⚠️ Invalid encrypted data format")
                    continue
                
                if "encrypted" not in encrypted_data or "iv" not in encrypted_data:
                    print("⚠️ Missing encryption fields")
                    continue
                
                # Store encrypted message
                message_doc = {
                    "room_id": room_id,
                    "username": message_data.get("username", current_username),
                    "encrypted_data": encrypted_data,
                    "timestamp": datetime.utcnow(),
                    "selfDestruct": message_data.get("selfDestruct", False),
                    "destructTime": message_data.get("destructTime")
                }
                
                try:
                    await db.messages.insert_one(message_doc)
                except Exception as e:
                    print(f"❌ Error saving message: {e}")
                
                # Broadcast to all users in room
                await manager.broadcast({
                    "type": "message",
                    "data": encrypted_data,
                    "username": message_data.get("username", current_username),
                    "timestamp": datetime.utcnow().isoformat(),
                    "selfDestruct": message_data.get("selfDestruct", False),
                    "destructTime": message_data.get("destructTime")
                }, room_id)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        if current_username != "Anonymous":
            await manager.broadcast({
                "type": "user_left",
                "username": current_username,
                "message": f"👋 {current_username} left the room",
                "timestamp": datetime.utcnow().isoformat()
            }, room_id)
            
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        manager.disconnect(websocket, room_id)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=port,
        log_level="info",
        access_log=True
    )
