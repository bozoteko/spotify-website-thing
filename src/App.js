import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const formatTime = (ms) => {
  if (isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const calculateRemainingTime = (durationMs, progressMs) => {
  if (!durationMs || !progressMs || durationMs <= 0) return '-0:00';
  const remainingMs = durationMs - progressMs;
  if (remainingMs < 0) return '-0:00';
  const totalSeconds = Math.floor(remainingMs / 1000);
  return `-${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

function App() {
  const [clientId, setClientId] = useState(() => localStorage.getItem('spotifyClientId') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [currentTrack, setCurrentTrack] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const playerContainerRef = useRef(null);
  const redirectUri = 'https://bozoteko.github.io/spotify-website-thing/';

  function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
  }

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return hashBuffer;
  }

  function base64encode(input) {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const storedClientId = clientId;
    const storedVerifier = localStorage.getItem('codeVerifier');

    if (code && storedClientId && storedVerifier) {
      exchangeCodeForToken(code, storedClientId, storedVerifier);
    }

    const savedToken = localStorage.getItem('spotifyAccessToken');
    if (savedToken) {
      setAccessToken(savedToken);
      setIsLoggedIn(true);
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      fetchNowPlaying();
      const interval = setInterval(fetchNowPlaying, 1000);
      return () => clearInterval(interval);
    }
  }, [accessToken]);

  useEffect(() => {
    let int = null;
    if (isPlaying) {
      int = setInterval(() => {
        setProgressMs(prev => Math.min(prev + 100, durationMs));
      }, 100);
    }
    return () => clearInterval(int);
  }, [isPlaying, durationMs]);

  useEffect(() => {
    if (playerContainerRef.current && currentTrack) {
      const img = currentTrack?.album?.images?.[0]?.url || null;
      playerContainerRef.current.style.setProperty('--bg-image', img ? `url(${img})` : 'none');
    }
  }, [currentTrack]);

  const handleLogin = async () => {
    if (!clientId.trim()) return alert("Please enter your Spotify Client ID!");

    localStorage.setItem('spotifyClientId', clientId);

    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    localStorage.setItem('codeVerifier', codeVerifier);

    const params = {
      response_type: 'code',
      client_id: clientId,
      scope: 'user-read-playback-state user-read-currently-playing user-modify-playback-state',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge
    };

    const authURL = new URL("https://accounts.spotify.com/authorize");
    authURL.search = new URLSearchParams(params).toString();
    window.location.href = authURL.toString();
  };

  const exchangeCodeForToken = async (code, clientId, codeVerifier) => {
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier
        })
      });

      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem('spotifyAccessToken', data.access_token);
        setAccessToken(data.access_token);
        setIsLoggedIn(true);
        window.history.replaceState({}, document.title, '/');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchNowPlaying = async () => {
    try {
      const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (res.status === 204) {
        setCurrentTrack(null);
        setIsPlaying(false);
        return;
      }

      if (res.status === 401) {
        localStorage.removeItem('spotifyAccessToken');
        setIsLoggedIn(false);
        setAccessToken('');
        return;
      }

      const data = await res.json();
      if (data?.item) {
        setCurrentTrack(data.item);
        setProgressMs(data.progress_ms || 0);
        setDurationMs(data.item.duration_ms || 0);
        setIsPlaying(data.is_playing);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const controlPlayback = async (action) => {
    if (!accessToken) return;

    let endpoint = '';
    let method = 'PUT';
    let body = null;

    if (action === 'play') endpoint = 'https://api.spotify.com/v1/me/player/play';
    if (action === 'pause') endpoint = 'https://api.spotify.com/v1/me/player/pause';
    if (action === 'next') { endpoint = 'https://api.spotify.com/v1/me/player/next'; method = 'POST'; }
    if (action === 'previous') { endpoint = 'https://api.spotify.com/v1/me/player/previous'; method = 'POST'; }

    try {
      await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body,
      });
    } catch (err) {
      console.error(err);
    }

    setTimeout(fetchNowPlaying, 300);
  };

  // Click to seek
  const seekTo = async (e) => {
    if (!accessToken || !durationMs) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const newProgressMs = Math.floor((clickX / width) * durationMs);

    try {
      await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${newProgressMs}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      setProgressMs(newProgressMs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleHover = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hoverPercent = ((e.clientX - rect.left) / rect.width) * 100;
    e.currentTarget.style.setProperty('--hover-x', `${hoverPercent}%`);
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <h1>SpotifyWebsiteThing</h1>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Enter Spotify Client ID"
        />
        <button className="login-btn" onClick={handleLogin}>Login to Spotify</button>
      </div>
    );
  }

  const progressPercent = durationMs ? (progressMs / durationMs) * 100 : 0;

  return (
    <div
      className="player-container"
      ref={playerContainerRef}
      style={{
        backgroundImage: `url(${currentTrack?.album?.images?.[0]?.url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {currentTrack ? (
        <>
          <div className="blur-bg"></div>

          <div className="main-content">
            <img
              src={currentTrack?.album?.images?.[0]?.url}
              alt="Album art"
              className="album-art"
            />

            <div className="track-info-wrapper">
              <div className="track-info">
                <h2>{currentTrack.name}</h2>
                <h3>{currentTrack.artists.map(a => a.name).join(', ')}</h3>
              </div>

              <div className="progress-section">
                <div className="time-labels">
                  <span>{formatTime(progressMs)}</span>
                  <span>{calculateRemainingTime(durationMs, progressMs)}</span>
                </div>

                <div
                  className="progress-container"
                  onClick={seekTo}
                  onMouseMove={handleHover}
                >
                  <div
                    className="progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div className="controls-bar">
            <button onClick={() => controlPlayback('previous')} className="control-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M11 12L20 18V6L11 12ZM4 6H6V18H4V6Z" fill="white"/>
              </svg>
            </button>

            <button
              onClick={() => controlPlayback(isPlaying ? 'pause' : 'play')}
              className="control-btn play-pause-btn"
            >
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path d="M6 6h4v12H6zm8 0h4v12h-4z" fill="white"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" fill="white"/>
                </svg>
              )}
            </button>

            <button onClick={() => controlPlayback('next')} className="control-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M4 6L13 12L4 18V6ZM14 6H16V18H14V6Z" fill="white"/>
              </svg>
            </button>
          </div>
        </>
      ) : (
        <div className="no-track">
          <h2>Nothing is Playing</h2>
        </div>
      )}
    </div>
  );
}

export default App;
