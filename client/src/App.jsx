import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import EmojiPicker from 'emoji-picker-react';

const NOTIFY_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3';

function App() {
  const [currentUser, setCurrentUser] = useState(localStorage.getItem('chat-user') || null);
  const [activeChat, setActiveChat] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authData, setAuthData] = useState({ user: '', pass: '' });

  if (!currentUser) {
    const handleAuth = async (e) => {
      e.preventDefault();
      const url = authMode === 'login' ? '/api/login' : '/api/register';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authData.user, password: authData.pass })
      });
      const data = await res.json();
      if (data.success) {
        if (authMode === 'login') {
          setCurrentUser(data.username);
          localStorage.setItem('chat-user', data.username);
        } else {
          alert("Успешно! Теперь войдите");
          setAuthMode('login');
        }
      } else alert(data.error);
    };

    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
              <circle cx="30" cy="30" r="30" fill="#2AABEE"/>
              <path d="M20 30L27 38L40 22" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2>{authMode === 'login' ? 'С возвращением!' : 'Регистрация'}</h2>
          <p className="auth-subtitle">{authMode === 'login' ? 'Войдите в свой аккаунт' : 'Создайте новый аккаунт'}</p>
          <form className="auth-form" onSubmit={handleAuth}>
            <div className="input-group">
              <input 
                placeholder="Логин" 
                required 
                value={authData.user}
                onChange={e => setAuthData({...authData, user: e.target.value})} 
              />
            </div>
            <div className="input-group">
              <input 
                type="password" 
                placeholder="Пароль" 
                required 
                value={authData.pass}
                onChange={e => setAuthData({...authData, pass: e.target.value})} 
              />
            </div>
            <button type="submit" className="auth-submit">
              {authMode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
          <div className="auth-toggle">
            {authMode === 'login' ? (
              <span>Нет аккаунта? <button onClick={() => setAuthMode('register')}>Создать</button></span>
            ) : (
              <span>Уже есть аккаунт? <button onClick={() => setAuthMode('login')}>Войти</button></span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <ChatScreen user={currentUser} activeChat={activeChat} setActiveChat={setActiveChat} logout={() => {localStorage.clear(); window.location.reload();}} />;
}

function ProfileView({ username, isMe, onClose, updateProfileTrigger }) {
  const [info, setInfo] = useState(null);
  const loadProfile = () => { fetch(`/api/profile/${username}`).then(r => r.json()).then(setInfo); };
  useEffect(() => { loadProfile(); }, [username]);

  const updateField = async (field, value) => {
    if (!isMe) return;
    await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...info, [field]: value, username: info.username })
    });
    loadProfile();
    updateProfileTrigger();
  };

  const onAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const fData = await res.json();
    updateField('avatar_url', fData.url);
  };

  if (!info) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-card" onClick={e => e.stopPropagation()}>
        <button className="close-modal" onClick={onClose}>×</button>
        <div className="profile-avatar-main">
          <img src={info.avatar_url} alt="avatar" />
          {isMe && <label className="change-avatar-label">📷<input type="file" hidden onChange={onAvatarChange}/></label>}
        </div>
        <div className="profile-info-section">
          {isMe ? (
            <>
              <input className="edit-input" defaultValue={info.display_name} placeholder="Имя" onBlur={e => updateField('display_name', e.target.value)} />
              <textarea className="edit-input" defaultValue={info.status} placeholder="Статус" onBlur={e => updateField('status', e.target.value)} />
            </>
          ) : (
            <><h2>{info.display_name || info.username}</h2><p className="status-text">{info.status}</p></>
          )}
        </div>
        <div className="avatar-history">
          <h4>История аватарок</h4>
          <div className="history-list">
            {info.avatar_history.map((h, i) => (
              <img key={i} src={h.url} onClick={() => isMe && updateField('avatar_url', h.url)} alt="history" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatScreen({ user, activeChat, setActiveChat, logout }) {
  const [messages, setMessages] = useState([]);
  const [dialogs, setDialogs] = useState([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [input, setInput] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [menu, setMenu] = useState({ visible: false, x: 0, y: 0, msg: null });
  const [myProfileOpen, setMyProfileOpen] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [myInfo, setMyInfo] = useState({});
  const [showSearch, setShowSearch] = useState(false);
  const [searchMessages, setSearchMessages] = useState([]);
  const inputRef = useRef(null); // Реф для текстового поля

  const partnerInfo = dialogs.find(d => d.contact === activeChat);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);
  const lastCountRef = useRef(0);

  const loadMyInfo = () => fetch(`/api/profile/${user}`).then(r => r.json()).then(setMyInfo);

  const scrollToBottom = (force = false) => {
    const container = messagesRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 200;
    if (force || isAtBottom) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'auto'
      });
    }
  };

  // Отметить сообщения как прочитанные
  const markAsRead = async () => {
    if (!activeChat || !user) return;
    try {
      await fetch(`/api/mark-read?user=${user}&fromUser=${activeChat}`);
    } catch (e) {}
  };

  const loadData = async () => {
    const dRes = await fetch(`/api/dialogs?user=${user}`);
    const dData = await dRes.json();
    setDialogs(dData);

    if (activeChat) {
      const mRes = await fetch(`/api/get-messages?me=${user}&withUser=${activeChat}`);
      const mData = await mRes.json();
      const isFirstLoad = lastCountRef.current === 0;

      if (mData.length !== lastCountRef.current) {
        if (!isFirstLoad && mData.length > lastCountRef.current && mData[mData.length - 1].sender !== user) {
          new Audio(NOTIFY_SOUND).play().catch(() => {});
        }
        setMessages(mData);
        lastCountRef.current = mData.length;
        if (isFirstLoad) setTimeout(() => scrollToBottom(true), 50);
      }
      // Отмечаем сообщения как прочитанные
      markAsRead();
    }
  };

  useEffect(() => {
    loadMyInfo();
    lastCountRef.current = 0;
    loadData();
    const t = setInterval(loadData, 2000);
    return () => clearInterval(t);
  }, [activeChat]);

  useEffect(() => { if (search.length > 1) fetch(`/api/users/search?query=${search}`).then(r => r.json()).then(setSearchResults); else setSearchResults([]); }, [search]);
  useEffect(() => { scrollToBottom(); }, [messages]);

  const uploadFile = async (file) => {
    if (!file || !activeChat) return;
    setIsUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const fData = await res.json();
      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: user, receiver: activeChat, text: fData.name, type: fData.type, fileUrl: fData.url, replyToId: replyingTo?.id })
      });
      setReplyingTo(null); await loadData(); scrollToBottom(true);
    } catch (e) { alert("Ошибка загрузки"); }
    setIsUploading(false);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) { e.preventDefault(); uploadFile(file); }
      }
    }
  };

  const onReact = async (msgId, emoji) => {
    await fetch('/api/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: msgId, username: user, emoji })
    });
    setMenu({ visible: false, x: 0, y: 0, msg: null });
    loadData();
  };

  const onSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || !activeChat) return;

    const currentText = input; // Сохраняем текст
    setInput(''); // Мгновенно очищаем поле
    setReplyingTo(null);
    setShowEmoji(false);

    // ВОЗВРАЩАЕМ ФОКУС: клавиатура не уберется
    if (inputRef.current) {
      inputRef.current.focus();
    }

    if (editingMsg) {
      await fetch(`/api/edit-message/${editingMsg.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentText, sender: user })
      });
      setEditingMsg(null);
    } else {
      const body = { sender: user, receiver: activeChat, text: currentText, type: 'text', replyToId: replyingTo?.id };
      await fetch('/api/send-message', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body) 
      });
    }

    await loadData();
    scrollToBottom(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const openMenu = (e, m) => {
    e.preventDefault();
    e.stopPropagation();
    // Распознаем координаты клика или тапа
    const x = e.pageX || (e.touches ? e.touches[0].pageX : e.clientX);
    const y = e.pageY || (e.touches ? e.touches[0].pageY : e.clientY);
    
    // Если меню открывается слишком близко к правому краю, сдвигаем его
    const adjustedX = x + 150 > window.innerWidth ? x - 150 : x;

    setMenu({ visible: true, x: adjustedX, y, msg: m });
  };

  return (
    <div className={`messenger-layout ${activeChat ? 'chat-active' : ''}`} onClick={() => { setMenu({ ...menu, visible: false }); setShowEmoji(false); }}>
      {myProfileOpen && <ProfileView username={user} isMe={true} onClose={() => setMyProfileOpen(false)} updateProfileTrigger={loadMyInfo} />}
      {viewUser && <ProfileView username={viewUser} isMe={false} onClose={() => setViewUser(null)} updateProfileTrigger={()=>{}} />}

      {menu.visible && (
        <div className="context-menu" style={{ top: menu.y, left: menu.x }} onClick={e => e.stopPropagation()}>
          <div className="quick-reactions">
            {['👍', '❤️', '🔥', '😂', '😮', '😢'].map(e => (
              <span key={e} onClick={() => onReact(menu.msg.id, e)}>{e}</span>
            ))}
          </div>
          <div className="menu-separator"></div>
          <div onClick={() => { setReplyingTo(menu.msg); setEditingMsg(null); setInput(''); setMenu({visible:false}) }}>Ответить</div>
          {menu.msg.sender === user && (
            <>
              <div onClick={() => { setEditingMsg(menu.msg); setInput(menu.msg.text); setMenu({visible:false}) }}>Изменить</div>
              <div className="delete-opt" onClick={() => fetch(`/api/delete-message/${menu.msg.id}`, {method: 'DELETE'}).then(loadData)}>Удалить</div>
            </>
          )}
        </div>
      )}

      <div className="sidebar">
        <div className="side-header" onClick={() => setMyProfileOpen(true)}>
          <div className="avatar-container">
            <img src={myInfo.avatar_url} alt="me" />
          </div>
          <div className="user-nick-box">
            <b className="display-name">{myInfo.display_name || user}</b>
            <span className="status-preview">{myInfo.status || 'На связи'}</span>
          </div>
          <button className="logout-icon-btn" onClick={(e) => { e.stopPropagation(); logout(); }}>🚪</button>
        </div>
        <div className="search-box">
          <input placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="search-results">
            {searchResults.map(u => (
              <div key={u.username} className="search-item" onClick={() => {setActiveChat(u.username); setSearch('');}}>
                ➕ {u.username}
              </div>
            ))}
          </div>
        </div>
        <div className="contacts-list">
          {dialogs.length === 0 ? (
            <div style={{padding: '20px', color: '#8e8e93', textAlign: 'center'}}>Нет диалогов</div>
          ) : (
            dialogs.map(d => (
              <div key={d.contact} className={`contact-item ${activeChat === d.contact ? 'active' : ''} ${d.unread_count > 0 ? 'unread' : ''}`} onClick={() => setActiveChat(d.contact)}>
                <div className="avatar-container small">
                  {d.avatar_url ? <img src={d.avatar_url} alt="" /> : <div className="avatar-placeholder">{d.contact[0].toUpperCase()}</div>}
                </div>
                <div className="contact-info">
                  <div className="contact-top">
                    <span className="contact-name">{d.display_name || d.contact}</span>
                    {d.last_time && <span className="contact-time">{d.last_time}</span>}
                  </div>
                  <div className="contact-bottom">
                    <span className="last-message">{d.last_message || 'Нет сообщений'}</span>
                    {d.unread_count > 0 && <span className="unread-badge">{d.unread_count}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="chat-window">
        {activeChat ? (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={() => {setActiveChat(null); lastCountRef.current = 0;}}>←</button>
              <div className="chat-partner-info" onClick={() => setViewUser(activeChat)}>
                <div className="avatar-container small">
                   {partnerInfo?.avatar_url ? <img src={partnerInfo.avatar_url} alt="" /> : <div className="avatar-placeholder">{activeChat[0]}</div>}
                </div>
                <b>{partnerInfo?.display_name || activeChat}</b>
              </div>
            </div>
            
            <div id="messages" ref={messagesRef}>
              {messages.map(m => (
                <div key={m.id} className={`msg-container ${m.sender === user ? 'my-cont' : 'other-cont'}`}>
                  <div className="reply-dot" onClick={(e) => { e.stopPropagation(); setReplyingTo(m); }}>↩</div>
                  <div 
                    className={`msg ${m.sender === user ? 'my' : 'other'}`} 
                    onContextMenu={(e) => openMenu(e, m)} 
                    onClick={(e) => { 
                      // На смартфонах открываем меню по обычному клику
                      if(window.innerWidth <= 768) openMenu(e, m); 
                    }}
                  >
                    {m.replyUser && (
                      <div className="reply-preview-in-chat">
                        <span className="reply-user">{m.replyUser}</span>
                        <span className="reply-text">{m.replyText}</span>
                      </div>
                    )}
                    
                    <div className="msg-text-content">
                      {m.type === 'image' ? (
                        <img 
                           src={m.fileUrl} 
                           className="chat-img" 
                           alt="" 
                           onClick={(e) => {
                             // Если на ПК — просто открываем картинку
                             // На мобилках onClick выше перехватит событие для меню
                             if(window.innerWidth > 768) {
                               e.stopPropagation(); 
                               window.open(m.fileUrl);
                             }
                           }} 
                        />
                      ) : m.type === 'file' ? (
                        <a href={m.fileUrl} className="file-link" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>📁 {m.text}</a>
                      ) : (
                        <span>{m.text}</span>
                      )}
                    </div>

                    {m.reactions && m.reactions.length > 0 && (
                      <div className="message-reactions">
                        {Object.entries(
                          m.reactions.reduce((acc, curr) => {
                            acc[curr.emoji] = (acc[curr.emoji] || 0) + 1;
                            return acc;
                          }, {})
                        ).map(([emoji, count]) => (
                          <div 
                            key={emoji} 
                            className={`reaction-badge ${m.reactions.some(r => r.user === user && r.emoji === emoji) ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onReact(m.id, emoji); }}
                          >
                            {emoji} <span>{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="msg-time">
                      {m.time}
                      {m.sender === user && (
                        <span className={`msg-status ${m.status || 'sent'}`}></span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {showEmoji && (
              <div className="emoji-container" onClick={e => e.stopPropagation()}>
                <EmojiPicker theme="dark" onEmojiClick={(emoji) => setInput(prev => prev + emoji.emoji)} />
              </div>
            )}

            {(replyingTo || editingMsg) && (
              <div className={`input-extra-bar ${editingMsg ? 'edit-bar' : 'reply-bar'}`}>
                <div className="bar-content">
                  <span className="bar-title">{editingMsg ? 'Редактирование' : `Ответ ${replyingTo.sender}`}</span>
                  <span className="bar-desc">{editingMsg ? editingMsg.text : replyingTo.text}</span>
                </div>
                <button onClick={() => { setReplyingTo(null); setEditingMsg(null); if(editingMsg) setInput(''); }}>×</button>
              </div>
            )}

            <form id="form" onSubmit={onSend}>
              <button type="button" className="attach-btn" onClick={(e) => { e.stopPropagation(); setShowEmoji(!showEmoji); }}>😊</button>
              <button type="button" className="attach-btn" onClick={() => fileRef.current.click()}>{isUploading ? '...' : '📎'}</button>
              <input type="file" ref={fileRef} style={{display:'none'}} onChange={(e) => uploadFile(e.target.files[0])} />
              <textarea 
                ref={inputRef} // Добавь эту строку
                id="main-input" 
                placeholder="Сообщение..." 
                value={input} 
                onChange={e => setInput(e.target.value)} 
                onKeyDown={handleKeyDown} 
                onPaste={handlePaste} 
                rows="1" 
              />
              <button type="submit" className="send-btn">{editingMsg ? '✔' : '➤'}</button>
            </form>
          </>
        ) : <div className="empty-chat">Выберите чат</div>}
      </div>
    </div>
  );
}

export default App;