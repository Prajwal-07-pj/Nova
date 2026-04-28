import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import novaLogo from "../assets/nova_logo.png";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const SAVED_PROMPTS_KEY = "nova.savedPrompts.v1";
const RESEARCH_TRAIL_KEY = "nova.researchTrail.v1";

function cleanAnswerText(raw) {
  return raw
    .replace(/<ANSWER>/g, "")
    .replace(/<\/ANSWER>/g, "")
    .replace(/<SOURCES>[\s\S]*?<\/SOURCES>/g, "")
    .replace(/<SOURCES>[\s\S]*/g, "")
    .replace(/<FOLLOW_UPS>[\s\S]*?<\/FOLLOW_UPS>/g, "")
    .replace(/<FOLLOW_UPS>[\s\S]*/g, "")
    .trim();
}

function parseFollowUps(raw) {
  const match = raw.match(/<FOLLOW_UPS>([\s\S]*?)<\/FOLLOW_UPS>/);
  if (!match) return [];
  const block = match[1];
  const questions = [...block.matchAll(/<question>([\s\S]*?)<\/question>/g)];
  return questions.map((q) => q[1].trim()).filter(Boolean);
}

function sourceScore(url) {
  if (!url) return "low";
  if (url.includes(".gov") || url.includes(".edu") || url.includes("wikipedia.org")) return "high";
  if (url.includes(".org") || url.includes(".io")) return "medium";
  return "low";
}

function toResearchPoint(query, answerLength, sourceCount) {
  return {
    id: crypto.randomUUID(),
    query,
    answerLength,
    sourceCount,
    createdAt: new Date().toISOString(),
  };
}

const MODEL_META = {
  groq: { label: "Groq", sub: "Llama 3.3 · 70B" },
  deepseek: { label: "DeepSeek", sub: "deepseek-chat" },
};

const Dashboard = () => {
  const navigate = useNavigate();
  const askInputRef = useRef(null);

  const [user, setUser] = useState(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [followUps, setFollowUps] = useState([]);
  const [sources, setSources] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [deepMode, setDeepMode] = useState(true);
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [researchTrail, setResearchTrail] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState("Discover");
  const [selectedModel, setSelectedModel] = useState("groq");
  const [availableModels, setAvailableModels] = useState([]);

  const sourceStats = useMemo(() => ({
    high: sources.filter((s) => sourceScore(s.url) === "high").length,
    medium: sources.filter((s) => sourceScore(s.url) === "medium").length,
    low: sources.filter((s) => sourceScore(s.url) === "low").length,
  }), [sources]);

  // Boot: load local state + fetch available models
  useEffect(() => {
    const existingPrompts = localStorage.getItem(SAVED_PROMPTS_KEY);
    const existingTrail = localStorage.getItem(RESEARCH_TRAIL_KEY);
    if (existingPrompts) setSavedPrompts(JSON.parse(existingPrompts));
    if (existingTrail) setResearchTrail(JSON.parse(existingTrail));

    fetch(`${BACKEND_URL}/models`)
      .then((res) => res.json())
      .then((data) => {
        const models = data.models || [];
        setAvailableModels(models);
        // Only override default if the current selection isn't available
        const currentAvailable = models.find((m) => m.id === selectedModel && m.available);
        if (!currentAvailable) {
          const first = models.find((m) => m.available);
          if (first) setSelectedModel(first.id);
        }
      })
      .catch((err) => console.error("Failed to fetch models:", err));
  }, []);

  useEffect(() => { localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(savedPrompts)); }, [savedPrompts]);
  useEffect(() => { localStorage.setItem(RESEARCH_TRAIL_KEY, JSON.stringify(researchTrail)); }, [researchTrail]);

  // Auth boot
  useEffect(() => {
    async function bootAuth() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { navigate("/auth"); return; }
      setUser(authUser);
    }
    bootAuth();
  }, [navigate]);

  // Sync user + load conversations
  useEffect(() => {
    if (!user) return;
    async function syncAndFetch() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) { setErrorMessage("Authentication failed: No token available"); return; }
        try {
          await axios.post(`${BACKEND_URL}/signin`, {}, { headers: { Authorization: `Bearer ${token}` } });
        } catch (signinError) {
          setErrorMessage("Signin failed: " + (signinError.response?.data?.message || signinError.message));
          return;
        }
        const response = await axios.get(`${BACKEND_URL}/conversation`, { headers: { Authorization: `Bearer ${token}` } });
        setConversations(response.data?.conversations || []);
      } catch (error) {
        setErrorMessage("Unable to load conversations: " + error.message);
      }
    }
    syncAndFetch();
  }, [user]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") e.preventDefault();
      if (e.key === "/" && document.activeElement !== askInputRef.current) {
        e.preventDefault();
        askInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function fetchConversation(conversationId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const response = await axios.get(`${BACKEND_URL}/conversation/${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setActiveConversation(response.data?.conversation || null);
      setAnswer(""); setSources([]); setFollowUps([]); setErrorMessage("");
    } catch {
      setErrorMessage("Unable to open conversation.");
    }
  }

  function speakAnswer() {
    if (!answer) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanAnswerText(answer));
    utterance.rate = 1; utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  const askNova = useCallback(async (overrideQuery) => {
    const trimmedQuery = (overrideQuery ?? query).trim();
    if (!trimmedQuery || isAsking) return;
    if (overrideQuery) setQuery(overrideQuery);

    setIsAsking(true);
    setErrorMessage("");
    setAnswer("");
    setSources([]);
    setFollowUps([]);
    setActiveConversation(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { navigate("/auth"); return; }

      const finalQuery = deepMode
        ? `${trimmedQuery}\n\nPlease include detailed reasoning and practical examples.`
        : trimmedQuery;

      const response = await fetch(`${BACKEND_URL}/nova_ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: finalQuery, model: selectedModel }),
      });

      if (!response.ok || !response.body) throw new Error("Failed to stream answer");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const sourceStart = buffer.indexOf("<SOURCES>");
        const followStart = buffer.indexOf("<FOLLOW_UPS>");
        const cutAt = [sourceStart, followStart].filter((i) => i !== -1);
        const displayEnd = cutAt.length ? Math.min(...cutAt) : buffer.length;
        setAnswer(buffer.slice(0, displayEnd).trim());

        const sourceEnd = buffer.indexOf("</SOURCES>");
        if (sourceStart !== -1 && sourceEnd !== -1) {
          const blob = buffer.slice(sourceStart + "<SOURCES>".length, sourceEnd).trim();
          if (blob) { try { setSources(JSON.parse(blob)); } catch { setSources([]); } }
        }

        const followEnd = buffer.indexOf("</FOLLOW_UPS>");
        if (followStart !== -1 && followEnd !== -1) {
          setFollowUps(parseFollowUps(buffer));
        }
      }

      setAnswer(cleanAnswerText(buffer));
      setFollowUps(parseFollowUps(buffer));
      setResearchTrail((prev) => [
        toResearchPoint(trimmedQuery, cleanAnswerText(buffer).length, sources.length),
        ...prev,
      ].slice(0, 20));
    } catch {
      setErrorMessage("Nova encountered a network issue. Please try again.");
    } finally {
      setIsAsking(false);
    }
  }, [query, isAsking, deepMode, selectedModel, navigate, sources.length]);

  function resetToHome() {
    setQuery(""); setAnswer(""); setSources([]); setFollowUps([]);
    setActiveConversation(null); setErrorMessage("");
  }

  // const tabs = ["Discover", "Finance", "Health", "Academic", "Patents"];
  const isResultsView = !!(activeConversation || answer || isAsking);
  const availableModelsList = availableModels.filter((m) => m.available);

  // ─── MODEL TOGGLE COMPONENT ────────────────────────────────────────────────
  const ModelToggle = () => (
    <div style={{ display: "flex", gap: 2, background: "#0e0e0d", border: "0.5px solid #252523", borderRadius: 8, padding: 2 }}>
      {availableModelsList.length === 0
        ? (
          <span style={{ padding: "5px 12px", fontSize: 11, color: "#444442", fontStyle: "italic" }}>
            Loading…
          </span>
        )
        : availableModelsList.map((model) => {
          const isActive = selectedModel === model.id;
          const meta = MODEL_META[model.id] || { label: model.name, sub: "" };
          return (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: isActive ? "#1e1e1c" : "transparent",
                color: isActive ? "#e8e8e6" : "#666664",
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                fontFamily: "inherit",
                transition: "all 0.15s ease",
                boxShadow: isActive ? "inset 0 0 0 0.5px #2e2e2c" : "none",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: isActive ? "#5a9e72" : "#333331",
                flexShrink: 0,
                transition: "background 0.15s",
              }} />
              {meta.label}
            </button>
          );
        })}
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        .n-shell {
          display: flex;
          height: 100vh;
          background: #0a0a09;
          color: #d8d8d5;
          font-family: 'DM Sans', -apple-system, sans-serif;
          font-size: 13px;
          overflow: hidden;
        }

        /* ── SIDEBAR ── */
        .n-sidebar {
          width: 224px;
          min-width: 224px;
          background: #0d0d0c;
          border-right: 0.5px solid #1e1e1c;
          display: flex;
          flex-direction: column;
          padding: 0;
        }

        .n-sidebar-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 20px 16px 14px;
          border-bottom: 0.5px solid #1a1a18;
        }

        .n-logo-mark {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          overflow: hidden;
          flex-shrink: 0;
        }

        .n-logo-mark img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .n-wordmark {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 17px;
          color: #e8e8e6;
          letter-spacing: 0.01em;
        }

        .n-new-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          width: calc(100% - 24px);
          margin: 12px 12px 4px;
          padding: 8px 12px;
          background: #161615;
          border: 0.5px solid #242422;
          border-radius: 8px;
          color: #a0a09e;
          font-size: 12.5px;
          font-family: inherit;
          cursor: pointer;
          text-align: left;
          transition: all 0.12s;
        }
        .n-new-btn:hover { background: #1c1c1a; border-color: #2e2e2c; color: #e8e8e6; }

        .n-new-shortcut {
          margin-left: auto;
          font-size: 10px;
          color: #333331;
          background: #161615;
          border: 0.5px solid #2a2a28;
          border-radius: 4px;
          padding: 1px 5px;
          letter-spacing: 0.05em;
        }

        .n-nav-section { padding: 16px 0 4px; }

        .n-nav-label {
          padding: 0 16px 6px;
          font-size: 10px;
          color: #3a3a38;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .n-nav-item {
          display: flex;
          align-items: center;
          gap: 9px;
          width: 100%;
          padding: 7px 16px;
          background: transparent;
          border: none;
          color: #666664;
          font-size: 12.5px;
          font-family: inherit;
          cursor: pointer;
          text-align: left;
          transition: color 0.1s;
        }
        .n-nav-item:hover { color: #c8c8c6; }
        .n-nav-icon { font-size: 13px; opacity: 0.6; }

        .n-history-scroll { flex: 1; overflow-y: auto; padding: 0 0 8px; }
        .n-history-scroll::-webkit-scrollbar { width: 3px; }
        .n-history-scroll::-webkit-scrollbar-thumb { background: #1e1e1c; border-radius: 2px; }

        .n-history-item {
          display: block;
          padding: 6px 16px;
          color: #555553;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          background: transparent;
          border: none;
          width: 100%;
          text-align: left;
          font-family: inherit;
          transition: color 0.1s;
        }
        .n-history-item:hover { color: #c8c8c6; }
        .n-history-item::before { content: '—  '; color: #2a2a28; font-size: 10px; }

        .n-sidebar-bottom {
          padding: 12px 14px;
          border-top: 0.5px solid #1a1a18;
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .n-avatar {
          width: 28px;
          height: 28px;
          background: #1a1a18;
          border: 0.5px solid #2a2a28;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 500;
          color: #888886;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }

        .n-user-email {
          font-size: 11.5px;
          color: #555553;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .n-logout-btn {
          padding: 4px 8px;
          border: 0.5px solid #242422;
          border-radius: 5px;
          background: transparent;
          color: #555553;
          font-size: 11px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.1s;
          white-space: nowrap;
        }
        .n-logout-btn:hover { border-color: #3a3a38; color: #a0a09e; }

        /* ── MAIN ── */
        .n-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        .n-topnav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          height: 48px;
          border-bottom: 0.5px solid #161615;
          flex-shrink: 0;
        }

        // .n-tabs { display: flex; gap: 0; }


        .n-tab {
          padding: 5px 14px;
          font-size: 12.5px;
          color: #555553;
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          position: relative;
          transition: color 0.1s;
          letter-spacing: 0.01em;
        }
        .n-tab:hover { color: #b0b0ae; }
        .n-tab.active { color: #e8e8e6; }
        .n-tab.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 14px;
          right: 14px;
          height: 0.5px;
          background: #4a4a48;
        }

        .n-topnav-right { display: flex; gap: 6px; align-items: center; }

        .n-icon-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: transparent;
          border: 0.5px solid #1e1e1c;
          color: #555553;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.1s;
        }
        .n-icon-btn:hover { background: #161615; color: #c8c8c6; border-color: #2e2e2c; }

        /* ── WELCOME ── */
        .n-welcome {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0 32px 80px;
          overflow-y: auto;
        }

        .n-hero {
          text-align: center;
          margin-bottom: 36px;
        }

        .n-hero-logo {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          overflow: hidden;
          margin: 0 auto 20px;
          border: 0.5px solid #242422;
        }

        .n-hero-logo img { width: 100%; height: 100%; object-fit: cover; }

        .n-hero-title {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 30px;
          color: #e8e8e6;
          margin: 0 0 8px;
          letter-spacing: -0.01em;
          line-height: 1.1;
        }

        .n-hero-sub {
          font-size: 13px;
          color: #444442;
          font-weight: 300;
          letter-spacing: 0.02em;
        }

        /* ── SEARCH BOX ── */
        .n-search-wrap {
          width: 100%;
          max-width: 640px;
          background: #0f0f0e;
          border: 0.5px solid #242422;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 10px;
          transition: border-color 0.15s;
        }
        .n-search-wrap:focus-within { border-color: #3a3a38; }

        .n-search-textarea {
          width: 100%;
          background: transparent;
          border: none;
          padding: 16px 18px 10px;
          color: #e8e8e6;
          font-size: 14.5px;
          resize: none;
          outline: none;
          font-family: inherit;
          font-weight: 300;
          line-height: 1.6;
          min-height: 56px;
          letter-spacing: 0.01em;
        }
        .n-search-textarea::placeholder { color: #333331; }

        .n-search-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px 8px 12px;
          border-top: 0.5px solid #161615;
        }

        .n-toolbar-left { display: flex; gap: 6px; align-items: center; }
        .n-toolbar-right { display: flex; align-items: center; gap: 8px; }

        .n-deep-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 0.5px solid #242422;
          background: transparent;
          color: #555553;
          font-size: 11.5px;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.12s;
          letter-spacing: 0.02em;
        }
        .n-deep-toggle.active { border-color: #3a3a38; color: #a0a09e; background: #141413; }
        .n-deep-toggle:hover { border-color: #2e2e2c; color: #888886; }

        .n-deep-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #2a2a28;
          flex-shrink: 0;
        }
        .n-deep-toggle.active .n-deep-dot { background: #5a9e72; }

        .n-submit-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #e8e8e6;
          border: none;
          color: #0a0a09;
          font-size: 15px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          transition: all 0.12s;
          flex-shrink: 0;
        }
        .n-submit-btn:hover:not(:disabled) { background: #fff; transform: scale(1.04); }
        .n-submit-btn:disabled { opacity: 0.25; cursor: not-allowed; transform: none; }
        .n-submit-btn.spinning { animation: n-spin 0.7s linear infinite; }
        @keyframes n-spin { to { transform: rotate(360deg); } }

        /* ── SUGGESTION CARD ── */
        .n-sugg-card {
          width: 100%;
          max-width: 640px;
          border: 0.5px solid #1a1a18;
          border-radius: 10px;
          overflow: hidden;
          background: #0d0d0c;
        }

        .n-sugg-pills {
          display: flex;
          border-bottom: 0.5px solid #161615;
          overflow-x: auto;
        }
        .n-sugg-pills::-webkit-scrollbar { display: none; }

        .n-sugg-pill {
          padding: 9px 16px;
          font-size: 12px;
          color: #555553;
          cursor: pointer;
          white-space: nowrap;
          border-right: 0.5px solid #161615;
          display: flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border-top: none;
          border-bottom: none;
          border-left: none;
          font-family: inherit;
          transition: color 0.1s;
          letter-spacing: 0.02em;
        }
        .n-sugg-pill:last-child { border-right: none; }
        .n-sugg-pill:hover { color: #c8c8c6; background: #111110; }
        .n-sugg-pill-icon { font-size: 11px; }

        .n-sugg-rows { padding: 2px 0; }

        .n-sugg-row {
          padding: 9px 16px;
          font-size: 12.5px;
          color: #555553;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 300;
          transition: all 0.1s;
          letter-spacing: 0.01em;
        }
        .n-sugg-row:hover { color: #c8c8c6; background: #111110; padding-left: 20px; }

        /* ── RESULTS ── */
        .n-results-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 28px 32px;
          gap: 20px;
        }
        .n-results-area::-webkit-scrollbar { width: 4px; }
        .n-results-area::-webkit-scrollbar-thumb { background: #1e1e1c; border-radius: 2px; }

        .n-back-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px;
          background: transparent;
          border: 0.5px solid #1e1e1c;
          border-radius: 6px;
          color: #555553;
          font-size: 12px;
          cursor: pointer;
          width: fit-content;
          font-family: inherit;
          transition: all 0.1s;
          letter-spacing: 0.02em;
        }
        .n-back-btn:hover { color: #c8c8c6; border-color: #2e2e2c; }

        .n-error {
          padding: 10px 14px;
          background: #150e0e;
          border: 0.5px solid #3a1c1c;
          border-radius: 7px;
          color: #c07070;
          font-size: 12.5px;
        }

        .n-compact-search {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #0f0f0e;
          border: 0.5px solid #242422;
          border-radius: 10px;
          padding: 10px 14px;
          max-width: 680px;
          transition: border-color 0.15s;
        }
        .n-compact-search:focus-within { border-color: #3a3a38; }

        .n-compact-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #e8e8e6;
          font-size: 13.5px;
          outline: none;
          font-family: inherit;
          font-weight: 300;
          resize: none;
          letter-spacing: 0.01em;
        }
        .n-compact-input::placeholder { color: #333331; }

        .n-results-cols { display: flex; gap: 32px; max-width: 960px; }
        .n-answer-col { flex: 1; min-width: 0; }
        .n-sources-col { width: 210px; flex-shrink: 0; }

        .n-answer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 0.5px solid #161615;
        }

        .n-answer-label {
          font-size: 10px;
          font-weight: 500;
          color: #333331;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .n-answer-actions { display: flex; gap: 5px; }

        .n-action-btn {
          width: 26px;
          height: 26px;
          background: transparent;
          border: 0.5px solid #1e1e1c;
          border-radius: 5px;
          color: #444442;
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.1s;
        }
        .n-action-btn:hover { color: #c8c8c6; border-color: #2e2e2c; }

        .n-answer-body {
          font-size: 14px;
          line-height: 1.8;
          color: #b8b8b5;
          white-space: pre-wrap;
          font-weight: 300;
          letter-spacing: 0.01em;
        }

        .n-thinking {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #444442;
          font-size: 12.5px;
          font-style: italic;
          letter-spacing: 0.02em;
        }

        .n-thinking-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #333331;
          animation: n-pulse 1.4s ease-in-out infinite;
        }
        .n-thinking-dot:nth-child(2) { animation-delay: 0.25s; }
        .n-thinking-dot:nth-child(3) { animation-delay: 0.5s; }
        @keyframes n-pulse { 0%,100% { opacity: 0.2; } 50% { opacity: 0.8; } }

        /* ── SOURCES ── */
        .n-sources-label {
          font-size: 10px;
          font-weight: 500;
          color: #333331;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 0.5px solid #161615;
        }

        .n-source-item {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 8px 0;
          border-bottom: 0.5px solid #131312;
          text-decoration: none;
          transition: opacity 0.1s;
        }
        .n-source-item:last-child { border-bottom: none; }
        .n-source-item:hover { opacity: 0.75; }

        .n-source-num {
          width: 16px;
          height: 16px;
          background: #141413;
          border: 0.5px solid #1e1e1c;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          color: #444442;
          flex-shrink: 0;
          margin-top: 2px;
          font-weight: 500;
        }

        .n-source-url {
          font-size: 11.5px;
          color: #666664;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .n-source-cred {
          font-size: 10px;
          color: #2e2e2c;
          margin-top: 2px;
          letter-spacing: 0.03em;
        }
        .n-source-cred.high { color: #3a6e4c; }
        .n-source-cred.medium { color: #6e5e2a; }

        /* ── CONVERSATION ── */
        .n-conv-title {
          font-family: 'DM Serif Display', Georgia, serif;
          font-size: 18px;
          color: #e8e8e6;
          margin-bottom: 16px;
          letter-spacing: -0.01em;
        }

        .n-message {
          padding: 10px 14px;
          border-radius: 7px;
          margin-bottom: 8px;
          font-size: 13.5px;
          line-height: 1.7;
          font-weight: 300;
        }
        .n-message.user { background: #141413; border: 0.5px solid #1e1e1c; color: #c8c8c6; }
        .n-message.assistant { color: #a0a09e; }

        /* ── FOLLOW-UPS ── */
        .n-followups { margin-top: 12px; max-width: 640px; }

        .n-followups-label {
          font-size: 10px;
          font-weight: 500;
          color: #333331;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 10px;
        }

        .n-followup-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
          border-bottom: 0.5px solid #131312;
          cursor: pointer;
          transition: all 0.1s;
        }
        .n-followup-item:first-of-type { border-top: 0.5px solid #131312; }
        .n-followup-item:hover .n-followup-text { color: #e8e8e6; }
        .n-followup-item:hover .n-followup-arr { color: #555553; }

        .n-followup-arr {
          font-size: 11px;
          color: #2e2e2c;
          flex-shrink: 0;
          transition: color 0.1s;
        }

        .n-followup-text {
          font-size: 13px;
          color: #666664;
          flex: 1;
          line-height: 1.5;
          font-weight: 300;
          letter-spacing: 0.01em;
          transition: color 0.1s;
        }

        .n-followup-chevron {
          font-size: 10px;
          color: #2e2e2c;
          flex-shrink: 0;
        }

        /* ── DIVIDER ── */
        .n-divider {
          height: 0.5px;
          background: #161615;
          margin: 4px 0;
        }
      `}</style>

      <div className="n-shell">
        {/* ── SIDEBAR ── */}
        <aside className="n-sidebar">
          <div className="n-sidebar-logo">
            <div className="n-logo-mark">
              <img src={novaLogo} alt="Nova" />
            </div>
            <span className="n-wordmark">Nova</span>
          </div>

          <button className="n-new-btn" onClick={resetToHome}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
            New thread
            <span className="n-new-shortcut">⌃I</span>
          </button>

          <div className="n-nav-section">
            <div className="n-nav-label">Workspace</div>
            <button className="n-nav-item"><span className="n-nav-icon">◻</span> Computer</button>
            <button className="n-nav-item"><span className="n-nav-icon">◈</span> Spaces</button>
            <button className="n-nav-item"><span className="n-nav-icon">◇</span> Customize</button>
          </div>

          <div className="n-divider" style={{ margin: "4px 16px" }} />

          <div className="n-nav-section" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="n-nav-label">Recent</div>
            <div className="n-history-scroll">
              {conversations.length === 0 ? (
                <p style={{ padding: "4px 16px", fontSize: 12, color: "#2e2e2c", fontStyle: "italic" }}>
                  No threads yet
                </p>
              ) : (
                conversations.slice(0, 18).map((item) => (
                  <button
                    key={item.id}
                    className="n-history-item"
                    onClick={() => fetchConversation(item.id)}
                    title={item.title || "Untitled"}
                  >
                    {item.title || "Untitled"}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="n-sidebar-bottom">
            <div className="n-avatar">{user?.email?.slice(0, 2).toUpperCase() || "—"}</div>
            <span className="n-user-email">{user?.email?.split("@")[0] || "User"}</span>
            <button
              className="n-logout-btn"
              onClick={async () => { await supabase.auth.signOut(); navigate("/auth"); }}
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="n-main">
          <nav className="n-topnav">
            {/* <div className="n-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  className={`n-tab${activeTab === tab ? " active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div> */}
            <div className="n-topnav-right">
              <button className="n-icon-btn" title="Settings">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="0.8" />
                  <path d="M6.5 1v1.5M6.5 10.5V12M1 6.5h1.5M10.5 6.5H12" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </nav>

          {!isResultsView ? (
            <div className="n-welcome">
              {errorMessage && (
                <div className="n-error" style={{ marginBottom: 20, maxWidth: 600 }}>{errorMessage}</div>
              )}

              <div className="n-hero">
                <div className="n-hero-logo">
                  <img src={novaLogo} alt="Nova" />
                </div>
                <h1 className="n-hero-title">What would you like to know?</h1>
                <p className="n-hero-sub">Intelligent research, at your fingertips</p>
              </div>

              {/* Search box */}
              <div className="n-search-wrap">
                <textarea
                  ref={askInputRef}
                  className="n-search-textarea"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askNova(); }
                  }}
                  placeholder="Ask anything…"
                  rows={2}
                />
                <div className="n-search-toolbar">
                  <div className="n-toolbar-left">
                    <button
                      className={`n-deep-toggle${deepMode ? " active" : ""}`}
                      onClick={() => setDeepMode((d) => !d)}
                    >
                      <span className="n-deep-dot" />
                      Deep mode
                    </button>
                    <ModelToggle />
                  </div>
                  <div className="n-toolbar-right">
                    <button
                      className={`n-submit-btn${isAsking ? " spinning" : ""}`}
                      onClick={() => askNova()}
                      disabled={isAsking || !query.trim()}
                    >
                      {isAsking ? "↻" : "↑"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Suggestion card */}
              <div className="n-sugg-card">
                <div className="n-sugg-pills">
                  {[
                    { icon: "◎", label: "Help me learn" },
                    { icon: "◈", label: "Recruiting" },
                    { icon: "◻", label: "Prototype" },
                    { icon: "◇", label: "Lead gen" },
                  ].map(({ icon, label }) => (
                    <button
                      key={label}
                      className="n-sugg-pill"
                      onClick={() => { setQuery(label); askInputRef.current?.focus(); }}
                    >
                      <span className="n-sugg-pill-icon">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="n-sugg-rows">
                  {[
                    "Create a study guide for a certification or exam",
                    "Help me understand a complex topic in depth",
                    "Compare tools or frameworks and recommend one",
                  ].map((text) => (
                    <div
                      key={text}
                      className="n-sugg-row"
                      onClick={() => { setQuery(text); askInputRef.current?.focus(); }}
                    >
                      {text}
                      <span style={{ opacity: 0.25, fontSize: 12 }}>›</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="n-results-area">
              <button className="n-back-btn" onClick={resetToHome}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M7 2L4 5.5L7 9" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>

              {errorMessage && <div className="n-error">{errorMessage}</div>}

              <div className="n-compact-search">
                <textarea
                  ref={askInputRef}
                  className="n-compact-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askNova(); }
                  }}
                  placeholder="Ask anything…"
                  rows={1}
                />
                <ModelToggle />
                <button
                  className={`n-submit-btn${isAsking ? " spinning" : ""}`}
                  onClick={() => askNova()}
                  disabled={isAsking || !query.trim()}
                  style={{ width: 28, height: 28, fontSize: 13 }}
                >
                  {isAsking ? "↻" : "↑"}
                </button>
              </div>

              <div className="n-results-cols">
                <div className="n-answer-col">
                  {isAsking && !answer && (
                    <div className="n-thinking">
                      <div className="n-thinking-dot" />
                      <div className="n-thinking-dot" />
                      <div className="n-thinking-dot" />
                      <span>Thinking…</span>
                    </div>
                  )}

                  {answer && (
                    <>
                      <div className="n-answer-header">
                        <span className="n-answer-label">Answer</span>
                        <div className="n-answer-actions">
                          <button className="n-action-btn" onClick={speakAnswer} title="Read aloud">♪</button>
                          <button
                            className="n-action-btn"
                            onClick={() => navigator.clipboard.writeText(cleanAnswerText(answer))}
                            title="Copy"
                          >
                            ⎘
                          </button>
                        </div>
                      </div>
                      <div className="n-answer-body">{cleanAnswerText(answer)}</div>
                    </>
                  )}

                  {activeConversation && (
                    <>
                      <div className="n-conv-title">{activeConversation.title || "Conversation"}</div>
                      {activeConversation.messages?.map((msg) => (
                        <div key={msg.id} className={`n-message ${msg.role}`}>{msg.content}</div>
                      ))}
                    </>
                  )}

                  {followUps.length > 0 && !isAsking && (
                    <div className="n-followups">
                      <div className="n-followups-label">Continue exploring</div>
                      {followUps.map((q, i) => (
                        <div key={i} className="n-followup-item" onClick={() => askNova(q)}>
                          <span className="n-followup-arr">↳</span>
                          <span className="n-followup-text">{q}</span>
                          <span className="n-followup-chevron">›</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {sources.length > 0 && (
                  <aside className="n-sources-col">
                    <div className="n-sources-label">Sources</div>
                    {sources.map((source, i) => (
                      <a
                        key={`${source.url}-${i}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="n-source-item"
                      >
                        <span className="n-source-num">{i + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="n-source-url">
                            {(() => { try { return new URL(source.url).hostname; } catch { return source.url; } })()}
                          </div>
                          <div className={`n-source-cred ${sourceScore(source.url)}`}>
                            {sourceScore(source.url)} credibility
                          </div>
                        </div>
                      </a>
                    ))}
                  </aside>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
};

export default Dashboard;