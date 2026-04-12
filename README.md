# Secure Temporary Chat Application

A real-time chat application focused on privacy and minimal data retention. The platform allows users to create temporary chat rooms that automatically expire after a fixed duration, ensuring conversations are not stored permanently.

---

## Overview

This application is designed for secure and short-lived communication. Users can create chat rooms, share them with others, and communicate in real time. Each room is automatically deleted after a defined time period (e.g., 1 hour), making it suitable for private and temporary discussions.

---

## Features

### Temporary Chat Rooms
- Create unique chat rooms for communication  
- Rooms automatically expire after a fixed duration  
- Ensures minimal data storage and improved privacy  

### Real-Time Messaging
- Instant message delivery using real-time communication  
- Smooth and responsive chat experience  

### Privacy-Focused Design
- No long-term message storage  
- Automatic room and message deletion  
- Designed for secure and temporary conversations  

### Room-Based Communication
- Users join rooms via shared room ID or link  
- Isolated chat environment per room  

### User Experience
- Clean and simple interface  
- Fast and lightweight interaction  
- Responsive design for multiple devices  

---

## Tech Stack

- Frontend: HTML, CSS, JavaScript / React (update as per your project)  
- Backend: Node.js, Express.js  
- Real-time Communication: Socket.io  
- Database: (Add if used, e.g., MongoDB or none for temporary storage)  

---

## Setup Instructions

### Run Backend
```bash
cd backend
npm install
npm run dev
```
### Run Frontend
``` bash
cd frontend
npm install
npm start

```
### How It Works
A user creates a chat room
A unique room ID or link is generated
Other users join using the room ID
Messages are exchanged in real time
The room is automatically deleted after the set time (e.g., 1 hour)

### Use Cases
Private conversations
Temporary discussions
Anonymous or short-term communication
Quick collaboration without data persistence

### Future Improvements
End-to-end encryption
File and media sharing
Adjustable room expiry duration
Typing indicators and read receipts

### Author

Rahul Sharma
```bash
https://github.com/rahul01879
```
