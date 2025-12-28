function TypingIndicator({ username }) {
  return (
    <div className="message theirs">
      <div className="message-content">
        <div className="message-username">{username}</div>
        <div className="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}

export default TypingIndicator;
