
import { useEffect, useState } from "react";
import "./App.css";
import "./Auth.css";

const DEMO_REVIEWS = `The product looks good and the build quality is decent for the price.
Battery life is good for normal daily use.
The sound quality is clear, but the bass could be better.
After two weeks, one customer noticed occasional Bluetooth disconnection.
Packaging was good and delivery was on time.
Overall, it is useful for everyday use, but connectivity may need improvement.`;

const INITIAL_FORM = {
  productName: "",
  price: "",
  source: "Amazon",
  reviews: "",
};

const INITIAL_COMPARE_FORM = {
  productA: { productName: "", price: "", source: "Amazon", reviews: "" },
  productB: { productName: "", price: "", source: "Amazon", reviews: "" },
};


// A lightweight, explainable estimate based on words in the pasted review text.
// This is not a trained sentiment model and does not verify review authenticity.
function getSentimentBreakdown(text) {
  const positiveWords = [
    "good", "great", "excellent", "love", "liked", "best", "clear",
    "comfortable", "fast", "easy", "useful", "decent", "amazing", "worth",
    "reliable", "recommend", "perfect", "smooth", "durable", "happy", "positive",
  ];
  const negativeWords = [
    "bad", "poor", "worst", "hate", "disappointed", "problem", "issue",
    "broken", "slow", "weak", "defect", "damage", "return", "overpriced",
    "uncomfortable", "disconnect", "not worth", "negative", "fails", "failed",
    "terrible", "waste",
  ];
  const sentences = String(text || "")
    .split(/[.!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let positive = 0;
  let negative = 0;
  let mixed = 0;

  sentences.forEach((sentence) => {
    const normalized = sentence.toLowerCase();
    const hasPositive = positiveWords.some((word) => normalized.includes(word));
    const hasNegative = negativeWords.some((word) => normalized.includes(word));
    if (hasPositive && !hasNegative) positive += 1;
    else if (hasNegative && !hasPositive) negative += 1;
    else mixed += 1;
  });

  return { positive, mixed, negative, total: sentences.length };
}

// Evidence score measures the amount and variety of text, not whether reviews are genuine.
function getEvidenceScore(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  const words = value.toLowerCase().match(/[a-z0-9']+/g) || [];
  const uniqueWords = new Set(words);
  const sentences = value.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean);
  const lengthScore = Math.min(40, Math.round((value.length / 1200) * 40));
  const sentenceScore = Math.min(35, sentences.length * 5);
  const diversityRatio = words.length ? uniqueWords.size / words.length : 0;
  const diversityScore = Math.min(25, Math.round(diversityRatio * 25));
  return Math.max(0, Math.min(100, lengthScore + sentenceScore + diversityScore));
}

function ResultList({ title, items, type }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <section className="result-card">
      <h3>
        <span className={`list-dot ${type || ""}`} />
        {title}
      </h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function DashboardApp({ user, onLogout }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState("");

  // Load only this logged-in user's saved reports from SQLite via the backend.
  useEffect(() => {
    let cancelled = false;
    async function loadSavedAnalyses() {
      setSavedLoading(true);
      setSavedError("");
      try {
        const token = sessionStorage.getItem("trustcart_token_v1");
        const response = await fetch("/api/saved-analyses", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (response.status === 401) {
          sessionStorage.removeItem("trustcart_token_v1");
          sessionStorage.removeItem("trustcart_user_v1");
          window.location.reload();
          return;
        }
        if (!response.ok) throw new Error(data.error || "Could not load saved history.");
        if (!cancelled) setSaved(Array.isArray(data.analyses) ? data.analyses : []);
      } catch (err) {
        if (!cancelled) setSavedError(err.message || "Could not load saved history.");
      } finally {
        if (!cancelled) setSavedLoading(false);
      }
    }
    loadSavedAnalyses();
    return () => { cancelled = true; };
  }, []);

  async function savedApi(path, options = {}) {
    const token = sessionStorage.getItem("trustcart_token_v1");
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("The server returned an unreadable response."); }
    if (!response.ok) throw new Error(data.error || "Saved history request failed.");
    return data;
  }
  const [compareForm, setCompareForm] = useState(INITIAL_COMPARE_FORM);
  const [compareResults, setCompareResults] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");

  function updateCompareField(productKey, field, value) {
    setCompareForm((previous) => ({
      ...previous,
      [productKey]: { ...previous[productKey], [field]: value },
    }));
  }

  async function handleCompare(event) {
    event.preventDefault();
    setCompareError("");
    setCompareResults(null);

    const products = [
      { key: "productA", ...compareForm.productA },
      { key: "productB", ...compareForm.productB },
    ];

    for (const product of products) {
      if (product.productName.trim().length < 2) {
        setCompareError("Enter a name for both products.");
        return;
      }
      if (product.reviews.trim().length < 30) {
        setCompareError("Paste at least 30 characters of reviews for each product.");
        return;
      }
    }

    setCompareLoading(true);
    try {
      const analyzeProduct = async (product) => {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productName: product.productName.trim(),
            price: product.price.trim(),
            source: product.source,
            reviews: product.reviews.trim(),
          }),
        });

        const responseText = await response.text();
        let data;
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          throw new Error(`The server returned an unreadable response for ${product.productName}.`);
        }

        if (!response.ok) {
          throw new Error(data.error || `Could not analyze ${product.productName}.`);
        }
        if (!data.analysis) {
          throw new Error(`No analysis was returned for ${product.productName}.`);
        }
        return { ...product, analysis: data.analysis };
      };

      const results = await Promise.all(products.map(analyzeProduct));
      setCompareResults(results);
    } catch (err) {
      setCompareError(err.message || "Comparison failed. Check that the backend is running.");
    } finally {
      setCompareLoading(false);
    }
  }

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  function loadDemo() {
    setForm({
      productName: "Wireless Bluetooth Headphones",
      price: "₹1,499",
      source: "Amazon",
      reviews: DEMO_REVIEWS,
    });
    setAnalysis(null);
    setError("");
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    setError("");
    setAnalysis(null);

    if (form.productName.trim().length < 2) {
      setError("Please enter a valid product name.");
      return;
    }

    if (form.reviews.trim().length < 30) {
      setError("Paste at least 30 characters of product reviews.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: form.productName.trim(),
          price: form.price.trim(),
          source: form.source,
          reviews: form.reviews.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not analyze these reviews.");
      }

      if (!data.analysis) {
        throw new Error("The server returned an unexpected response.");
      }

      setAnalysis(data.analysis);
    } catch (err) {
      setError(
        err.message ||
          "Cannot connect to the backend. Check that the backend terminal is running."
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveAnalysis() {
    if (!analysis) return;
    setSavedError("");
    try {
      const data = await savedApi("/api/saved-analyses", {
        method: "POST",
        body: JSON.stringify({
          productName: form.productName.trim(),
          price: form.price.trim(),
          source: form.source,
          reviews: form.reviews,
          analysis,
        }),
      });
      setSaved((previous) => [data.analysis, ...previous]);
    } catch (err) {
      setSavedError(err.message || "Could not save this report.");
    }
  }

  async function clearSavedAnalyses() {
    if (!window.confirm("Delete all saved reports for your account? This cannot be undone.")) return;
    setSavedError("");
    try {
      await savedApi("/api/saved-analyses/all", { method: "DELETE" });
      setSaved([]);
    } catch (err) {
      setSavedError(err.message || "Could not clear saved history.");
    }
  }

  async function deleteSavedAnalysis(item) {
    if (!window.confirm(`Delete the saved report for ${item.productName}?`)) return;
    setSavedError("");
    try {
      await savedApi(`/api/saved-analyses/${item.id}`, { method: "DELETE" });
      setSaved((previous) => previous.filter((report) => report.id !== item.id));
    } catch (err) {
      setSavedError(err.message || "Could not delete this report.");
    }
  }

  const verdict = analysis?.verdict || "Not available";
  const verdictClass =
    verdict.toLowerCase() === "buy"
      ? "buy"
      : verdict.toLowerCase() === "avoid"
      ? "avoid"
      : "consider";
  const sentimentBreakdown = getSentimentBreakdown(form.reviews);
  const sentimentTotal = sentimentBreakdown.total || 1;
  const evidenceScore = getEvidenceScore(form.reviews);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home">
          <span className="brand-icon">✓</span>
          <span>
            TrustCart<span className="brand-ai"> AI</span>
          </span>
        </a>

        <p className="nav-label">WORKSPACE</p>
        <a className="nav-item active" href="#analyzer">
          <span>◈</span> Review Analyzer
        </a>
        <a className="nav-item" href="#compare">
          <span>⇄</span> Product Comparison
        </a>
        <a className="nav-item" href="#saved">
          <span>▣</span> Saved Analyses
          <span className="nav-count">{saved.length}</span>
        </a>

        <div className="sidebar-bottom">
          <div className="privacy-icon">✦</div>
          <h3>Shop with clarity.</h3>
          <p>Understand the reviews before you make a decision.</p>
          <span className="local-badge">● AI ANALYSIS</span>
        </div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> Review Analyzer
          </div>
          <div className="auth-top-user">
            <span className="status-dot" />
            <span>{user?.name || "Shopper"}</span>
            <button type="button" onClick={onLogout}>Log out</button>
          </div>
        </header>

        <section className="page-heading" id="analyzer">
          <div>
            <p className="eyebrow">YOUR SMARTER SHOPPING ASSISTANT</p>
            <h1>Reviews, decoded.</h1>
            <p className="page-subtitle">
              Cut through the noise. Discover what customers really think
              about a product.
            </p>
          </div>
          <button className="demo-button" type="button" onClick={loadDemo}>
            ✨ Try sample reviews
          </button>
        </section>

        <div className="workspace-grid">
          <section className="input-panel">
            <div className="panel-heading">
              <div>
                <span className="step-label">STEP 01</span>
                <h2>Product details</h2>
              </div>
              <span className="panel-symbol">↗</span>
            </div>

            <form onSubmit={handleAnalyze}>
              <label htmlFor="productName">Product name *</label>
              <input
                id="productName"
                name="productName"
                value={form.productName}
                onChange={updateField}
                placeholder="e.g. Wireless headphones"
                maxLength={150}
                required
              />

              <div className="form-row">
                <div>
                  <label htmlFor="price">Price</label>
                  <input
                    id="price"
                    name="price"
                    value={form.price}
                    onChange={updateField}
                    placeholder="e.g. ₹1,499"
                    maxLength={50}
                  />
                </div>
                <div>
                  <label htmlFor="source">Review source</label>
                  <select
                    id="source"
                    name="source"
                    value={form.source}
                    onChange={updateField}
                  >
                    <option>Amazon</option>
                    <option>Flipkart</option>
                    <option>Other website</option>
                    <option>Mixed sources</option>
                  </select>
                </div>
              </div>

              <div className="review-label-row">
                <label htmlFor="reviews">Paste customer reviews *</label>
                <span>{form.reviews.length}/12000</span>
              </div>
              <textarea
                id="reviews"
                name="reviews"
                value={form.reviews}
                onChange={updateField}
                placeholder="Paste product reviews here. Include positive and negative reviews for a more balanced analysis..."
                rows={9}
                maxLength={12000}
                required
              />

              <div className="input-hint">
                <span>ⓘ</span> Paste reviews copied from the product page.
              </div>

              {error && (
                <div className="error-message" role="alert">
                  <strong>Analysis couldn't run</strong>
                  <p>{error}</p>
                </div>
              )}

              <button
                className="analyze-button"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner" /> Analyzing reviews...
                  </>
                ) : (
                  <>✦ Analyze with AI <span>→</span></>
                )}
              </button>
              <p className="secure-note">
                Your submitted reviews are sent to the configured AI service
                for analysis.
              </p>
            </form>
          </section>

          <section className="results-panel">
            {!analysis && !loading && (
              <div className="empty-state">
                <div className="empty-illustration">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="empty-document">
                    <span>✦</span>
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="floating-star">✧</div>
                  <div className="floating-check">✓</div>
                </div>
                <span className="step-label">YOUR INSIGHTS</span>
                <h2>Your buying clarity starts here.</h2>
                <p>
                  Add a product and its customer reviews. Your AI-powered
                  breakdown will appear here.
                </p>
                <div className="feature-chips">
                  <span>◉ Sentiment</span>
                  <span>＋ Pros & cons</span>
                  <span>↗ Verdict</span>
                </div>
              </div>
            )}

            {loading && (
              <div className="empty-state loading-state">
                <div className="loading-orb">✦</div>
                <h2>Finding the signal in the noise...</h2>
                <p>AI is reviewing the text you provided.</p>
                <div className="loading-track">
                  <span />
                </div>
              </div>
            )}

            {analysis && (
              <div className="analysis-results">
                <div className="result-topline">
                  <div>
                    <span className="step-label">ANALYSIS COMPLETE</span>
                    <h2>Your review report</h2>
                    <p className="result-product">{form.productName}</p>
                  </div>
                  <button
                    type="button"
                    className="save-button"
                    onClick={saveAnalysis}
                  >
                    ＋ Save
                  </button>
                </div>

                <div className="verdict-card">
                  <div>
                    <span className="verdict-caption">AI BUYING VERDICT</span>
                    <h2 className={`verdict-text ${verdictClass}`}>
                      {verdict}
                    </h2>
                    <p>{analysis.verdictReason}</p>
                  </div>
                  <div className={`verdict-icon ${verdictClass}`}>
                    {verdictClass === "buy"
                      ? "✓"
                      : verdictClass === "avoid"
                      ? "!"
                      : "?"}
                  </div>
                </div>

                <div className="metric-grid">
                  <div className="metric-card">
                    <span>Overall sentiment</span>
                    <strong>{analysis.sentiment || "Unknown"}</strong>
                    <div className="metric-track">
                      <span
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, Number(analysis.sentimentScore) || 0)
                          )}%`,
                        }}
                      />
                    </div>
                    <small>
                      {Number.isFinite(Number(analysis.sentimentScore))
                        ? `${analysis.sentimentScore}/100`
                        : "Score unavailable"}
                    </small>
                  </div>
                  <div className="metric-card">
                    <span>Value for money</span>
                    <strong className="metric-value">
                      {analysis.valueForMoney || "Not enough information"}
                    </strong>
                    <small>Based on supplied reviews</small>
                  </div>
                </div>

                <section className="result-card insight-meter-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
                    <div>
                      <h3>Review tone breakdown</h3>
                      <p style={{ margin: "6px 0 16px", color: "var(--muted, #9ca3af)", fontSize: "0.9rem" }}>
                        A quick text-based estimate of the review sentences you pasted.
                      </p>
                    </div>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted, #9ca3af)" }}>
                      {sentimentBreakdown.total} sentence{sentimentBreakdown.total === 1 ? "" : "s"}
                    </span>
                  </div>
                  {[{
                    label: "Positive",
                    count: sentimentBreakdown.positive,
                    color: "#34d399",
                  }, {
                    label: "Mixed / unclear",
                    count: sentimentBreakdown.mixed,
                    color: "#fbbf24",
                  }, {
                    label: "Negative",
                    count: sentimentBreakdown.negative,
                    color: "#fb7185",
                  }].map((item) => {
                    const percentage = sentimentBreakdown.total
                      ? Math.round((item.count / sentimentTotal) * 100)
                      : 0;
                    return (
                      <div key={item.label} style={{ marginBottom: "14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "6px", fontSize: "0.88rem" }}>
                          <span>{item.label}</span>
                          <span>{item.count} · {percentage}%</span>
                        </div>
                        <div style={{ height: "8px", background: "rgba(148, 163, 184, 0.16)", borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ width: `${percentage}%`, height: "100%", background: item.color, borderRadius: "999px", transition: "width 250ms ease" }} />
                        </div>
                      </div>
                    );
                  })}
                  <p style={{ margin: "8px 0 0", color: "var(--muted, #9ca3af)", fontSize: "0.78rem", lineHeight: 1.5 }}>
                    This simple estimate uses keyword matching. It can miss sarcasm, context, and nuanced opinions; use the AI report for the broader summary.
                  </p>
                </section>

                <section className="result-card evidence-score-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                    <div>
                      <h3>Review evidence score</h3>
                      <p style={{ margin: "6px 0 0", color: "var(--muted, #9ca3af)", fontSize: "0.9rem" }}>
                        How much text evidence is available for this analysis
                      </p>
                    </div>
                    <strong style={{ fontSize: "1.6rem", whiteSpace: "nowrap" }}>{evidenceScore}<span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--muted, #9ca3af)" }}>/100</span></strong>
                  </div>
                  <div style={{ height: "9px", marginTop: "16px", background: "rgba(148, 163, 184, 0.16)", borderRadius: "999px", overflow: "hidden" }}>
                    <div style={{ width: `${evidenceScore}%`, height: "100%", background: evidenceScore >= 70 ? "#34d399" : evidenceScore >= 40 ? "#fbbf24" : "#fb7185", borderRadius: "999px", transition: "width 250ms ease" }} />
                  </div>
                  <p style={{ margin: "10px 0 0", color: "var(--muted, #9ca3af)", fontSize: "0.82rem", lineHeight: 1.5 }}>
                    {evidenceScore >= 70
                      ? "More text and variety are available to work with."
                      : evidenceScore >= 40
                      ? "Some useful text is available; more varied reviews may improve the analysis."
                      : "Limited text evidence. Add more varied customer reviews for a more useful summary."}
                    {" "}This is not a fake-review detector or an authenticity rating.
                  </p>
                </section>

                <section className="result-card summary-card">
                  <h3>✦ Executive summary</h3>
                  <p>{analysis.summary}</p>
                </section>

                <div className="pros-cons-grid">
                  <ResultList title="What people like" items={analysis.pros} type="positive" />
                  <ResultList title="Potential downsides" items={analysis.cons} type="negative" />
                </div>

                <ResultList
                  title="Recurring complaints"
                  items={analysis.complaints}
                  type="negative"
                />
                <div className="pros-cons-grid">
                  <ResultList title="Best suited for" items={analysis.bestFor} type="positive" />
                  <ResultList title="Things to watch out for" items={analysis.watchOutFor} type="negative" />
                </div>

                <div className="confidence-note">
                  <span>ⓘ</span>
                  <p>
                    AI confidence: <strong>{analysis.confidence || "Not specified"}</strong>.
                    This report analyzes only the text you pasted; it does
                    not independently verify reviews or product claims.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="saved-section" id="compare">
          <div className="saved-heading">
            <div>
              <span className="step-label">SMART SHOPPING TOOL</span>
              <h2>Compare two products</h2>
              <p className="page-subtitle">
                Paste reviews for both products to compare their AI reports side by side.
              </p>
            </div>
          </div>

          <form onSubmit={handleCompare}>
            <div className="workspace-grid">
              {[
                { key: "productA", title: "Product A" },
                { key: "productB", title: "Product B" },
              ].map(({ key, title }) => (
                <section className="input-panel" key={key}>
                  <div className="panel-heading">
                    <div>
                      <span className="step-label">{title.toUpperCase()}</span>
                      <h2>{title} details</h2>
                    </div>
                    <span className="panel-symbol">{key === "productA" ? "A" : "B"}</span>
                  </div>

                  <label htmlFor={`${key}-name`}>Product name *</label>
                  <input
                    id={`${key}-name`}
                    value={compareForm[key].productName}
                    onChange={(event) => updateCompareField(key, "productName", event.target.value)}
                    placeholder={key === "productA" ? "e.g. Headphones A" : "e.g. Headphones B"}
                    maxLength={150}
                    required
                  />

                  <div className="form-row">
                    <div>
                      <label htmlFor={`${key}-price`}>Price</label>
                      <input
                        id={`${key}-price`}
                        value={compareForm[key].price}
                        onChange={(event) => updateCompareField(key, "price", event.target.value)}
                        placeholder="e.g. ₹1,499"
                        maxLength={50}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${key}-source`}>Review source</label>
                      <select
                        id={`${key}-source`}
                        value={compareForm[key].source}
                        onChange={(event) => updateCompareField(key, "source", event.target.value)}
                      >
                        <option>Amazon</option>
                        <option>Flipkart</option>
                        <option>Other website</option>
                        <option>Mixed sources</option>
                      </select>
                    </div>
                  </div>

                  <div className="review-label-row">
                    <label htmlFor={`${key}-reviews`}>Customer reviews *</label>
                    <span>{compareForm[key].reviews.length}/12000</span>
                  </div>
                  <textarea
                    id={`${key}-reviews`}
                    value={compareForm[key].reviews}
                    onChange={(event) => updateCompareField(key, "reviews", event.target.value)}
                    placeholder="Paste reviews for this product (at least 30 characters)..."
                    rows={7}
                    maxLength={12000}
                    required
                  />
                </section>
              ))}
            </div>

            {compareError && (
              <div className="error-message" role="alert">
                <strong>Comparison couldn't run</strong>
                <p>{compareError}</p>
              </div>
            )}

            <button className="analyze-button" type="submit" disabled={compareLoading}>
              {compareLoading ? (
                <><span className="spinner" /> Analyzing both products...</>
              ) : (
                <>⇄ Compare products <span>→</span></>
              )}
            </button>
            <p className="secure-note">
              Each product is analyzed separately using the reviews you paste. Reviews are not fetched automatically from Amazon or Flipkart.
            </p>
          </form>

          {compareResults && (
            <section className="result-card" style={{ marginTop: "24px" }}>
              <div className="saved-heading">
                <div>
                  <span className="step-label">COMPARISON COMPLETE</span>
                  <h2>Side-by-side results</h2>
                </div>
              </div>

              <div className="pros-cons-grid">
                {compareResults.map((item) => {
                  const score = Number(item.analysis.sentimentScore);
                  const verdictText = item.analysis.verdict || "Not available";
                  const verdictTone = verdictText.toLowerCase() === "buy"
                    ? "buy"
                    : verdictText.toLowerCase() === "avoid"
                    ? "avoid"
                    : "consider";
                  const tone = getSentimentBreakdown(item.reviews);
                  const evidence = getEvidenceScore(item.reviews);

                  return (
                    <article className="result-card" key={item.key}>
                      <span className="step-label">{item.key === "productA" ? "PRODUCT A" : "PRODUCT B"}</span>
                      <h3>{item.productName}</h3>
                      <p>{item.price || "Price not provided"}</p>
                      <div className="verdict-card">
                        <div>
                          <span className="verdict-caption">AI BUYING VERDICT</span>
                          <h2 className={`verdict-text ${verdictTone}`}>{verdictText}</h2>
                          <p>{item.analysis.verdictReason || "No verdict explanation returned."}</p>
                        </div>
                      </div>
                      <div className="metric-grid">
                        <div className="metric-card">
                          <span>Sentiment</span>
                          <strong>{item.analysis.sentiment || "Unknown"}</strong>
                          <small>{Number.isFinite(score) ? `${score}/100` : "Score unavailable"}</small>
                        </div>
                        <div className="metric-card">
                          <span>Review evidence</span>
                          <strong>{evidence}/100</strong>
                          <small>Text quantity and variety, not authenticity</small>
                        </div>
                      </div>
                      <p><strong>Summary:</strong> {item.analysis.summary || "Not available"}</p>
                      <ResultList title="Pros" items={item.analysis.pros} type="positive" />
                      <ResultList title="Cons" items={item.analysis.cons} type="negative" />
                      <ResultList title="Recurring complaints" items={item.analysis.complaints} type="negative" />
                      <div style={{ marginTop: "12px", fontSize: "0.85rem", color: "var(--muted, #9ca3af)" }}>
                        Quick text estimate: {tone.positive} positive · {tone.mixed} mixed/unclear · {tone.negative} negative sentences
                      </div>
                    </article>
                  );
                })}
              </div>

              <p className="confidence-note">
                Compare the price, review text, and reports together. The higher sentiment score alone does not guarantee better quality; these results only reflect the text supplied.
              </p>
            </section>
          )}
        </section>

        <section className="saved-section" id="saved">
          <div className="saved-heading">
            <div>
              <span className="step-label">YOUR WORKSPACE</span>
              <h2>Saved analyses</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span className="saved-total">{saved.length} saved</span>
              {saved.length > 0 && (
                <button
                  type="button"
                  className="view-button"
                  onClick={clearSavedAnalyses}
                >
                  Clear history
                </button>
              )}
            </div>
          </div>

          {savedError && <div className="error-message" role="alert"><strong>Saved history notice</strong><p>{savedError}</p></div>}
          {savedLoading ? (
            <p className="saved-empty">Loading your saved reports from the database...</p>
          ) : saved.length === 0 ? (
            <p className="saved-empty">
              No saved reports yet. Analyze a product and press “＋ Save”. Your reports will be available when you sign in again.
            </p>
          ) : (
            <div className="saved-list">
              {saved.map((item) => (
                <article className="saved-item" key={item.id}>
                  <div className="saved-product-icon">◈</div>
                  <div className="saved-product-info">
                    <strong>{item.productName}</strong>
                    <span>{item.price || "Price not provided"} · {item.source || "Source not provided"}</span>
                    <span style={{ display: "block", marginTop: "4px", opacity: 0.7, fontSize: "12px" }}>
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Saved report"}
                    </span>
                  </div>
                  <span className={`saved-verdict ${item.analysis.verdict?.toLowerCase()}`}>
                    {item.analysis.verdict}
                  </span>
                  <button
                    type="button"
                    className="view-button"
                    onClick={() => {
                      setForm((previous) => ({
                        ...previous,
                        productName: item.productName,
                        price: item.price || "",
                        source: item.source || "Amazon",
                        reviews: item.reviews || "",
                      }));
                      setAnalysis(item.analysis);
                      setError("");
                      document.getElementById("analyzer")?.scrollIntoView({
                        behavior: "smooth",
                      });
                    }}
                  >
                    View report →
                  </button>
                  <button
                    type="button"
                    className="view-button"
                    onClick={() => deleteSavedAnalysis(item)}
                    aria-label={`Delete saved report for ${item.productName}`}
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="footer">
          <span>TrustCart AI</span>
          <span>Make informed decisions, not impulse buys.</span>
        </footer>
      </main>
    </div>
  );
}


export default function App() {
  const [authMode, setAuthMode] = useState("signup");
  const [user, setUser] = useState(() => {
    try {
      const savedUser = sessionStorage.getItem("trustcart_user_v1");
      const token = sessionStorage.getItem("trustcart_token_v1");
      return savedUser && token ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function updateAuthField(event) {
    const { name, value } = event.target;
    setAuthForm((previous) => ({ ...previous, [name]: value }));
  }

  function switchAuthMode(mode) {
    setAuthMode(mode);
    setAuthError("");
    setAuthMessage("");
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    const name = authForm.name.trim();
    const email = authForm.email.trim().toLowerCase();
    if (authMode === "signup" && name.length < 2) {
      setAuthError("Please enter your name (at least 2 characters).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError("Please enter a valid email address.");
      return;
    }
    if (authForm.password.length < 8 || authForm.password.length > 72) {
      setAuthError("Password must be between 8 and 72 characters.");
      return;
    }
    setAuthLoading(true);
    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload = authMode === "signup"
        ? { name, email, password: authForm.password }
        : { email, password: authForm.password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; }
      catch { throw new Error("Server response was not readable. Check that the backend is running."); }
      if (!response.ok) throw new Error(data.error || "Authentication failed. Please try again.");
      if (!data.token || !data.user) throw new Error("The server did not return the login details expected by the app.");
      sessionStorage.setItem("trustcart_token_v1", data.token);
      sessionStorage.setItem("trustcart_user_v1", JSON.stringify(data.user));
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (error) {
      setAuthError(error.message || "Could not connect to TrustCart AI. Check the backend terminal.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("trustcart_token_v1");
    sessionStorage.removeItem("trustcart_user_v1");
    setUser(null);
    setAuthMode("login");
    setAuthMessage("You have been logged out.");
    setAuthError("");
  }

  if (user) return <DashboardApp user={user} onLogout={handleLogout} />;

  return (
    <div className="auth-page">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <header className="auth-nav">
        <a className="auth-brand" href="#welcome" aria-label="TrustCart AI home">
          <span className="auth-brand-icon">🛒</span>
          <span>TrustCart <b>AI</b></span>
        </a>
        <div className="auth-nav-actions">
          <button type="button" className="auth-nav-link" onClick={() => document.getElementById("auth-features")?.scrollIntoView({ behavior: "smooth" })}>Features</button>
          <button type="button" className="auth-nav-secondary" onClick={() => switchAuthMode("login")}>Log in</button>
          <button type="button" className="auth-nav-primary" onClick={() => switchAuthMode("signup")}>Sign up</button>
        </div>
      </header>

      <main className="auth-layout" id="welcome">
        <section className="auth-intro">
          <span className="auth-eyebrow"><span /> YOUR SMARTER SHOPPING ASSISTANT</span>
          <h1>Smarter reviews.<br /><span>Better decisions.</span></h1>
          <p className="auth-lead">Big purchase? Mixed reviews? Turn customer feedback into clear, practical insights before you buy.</p>
          <div className="auth-benefits" id="auth-features">
            <div className="auth-benefit"><span className="benefit-icon blue">✦</span><div><strong>AI review analysis</strong><p>Get a clear summary of the reviews you provide.</p></div></div>
            <div className="auth-benefit"><span className="benefit-icon purple">↗</span><div><strong>Pros, cons & complaints</strong><p>Spot the good, the bad, and recurring issues.</p></div></div>
            <div className="auth-benefit"><span className="benefit-icon cyan">⇄</span><div><strong>Compare before you buy</strong><p>Evaluate two products side by side.</p></div></div>
          </div>
          <div className="auth-trust-note"><span>✓</span> Make informed decisions, not impulse buys.</div>
        </section>

        <section className="auth-card-wrap" aria-label={authMode === "signup" ? "Create account" : "Log in"}>
          <div className="auth-card-top"><div className="auth-card-mark">✦</div><p className="auth-card-kicker">WELCOME TO TRUSTCART AI</p><h2>{authMode === "signup" ? "Create your account" : "Welcome back"}</h2><p>{authMode === "signup" ? "Start shopping with more confidence." : "Log in to continue to your workspace."}</p></div>
          <div className="auth-tabs"><button type="button" className={authMode === "login" ? "selected" : ""} onClick={() => switchAuthMode("login")}>Log in</button><button type="button" className={authMode === "signup" ? "selected" : ""} onClick={() => switchAuthMode("signup")}>Create account</button></div>
          {authMessage && <div className="auth-success" role="status">{authMessage}</div>}
          {authError && <div className="auth-error" role="alert">{authError}</div>}
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "signup" && <div className="auth-field"><label htmlFor="auth-name">Full name</label><div className="auth-input-wrap"><span>♙</span><input id="auth-name" name="name" value={authForm.name} onChange={updateAuthField} placeholder="Enter your name" autoComplete="name" maxLength={80} required /></div></div>}
            <div className="auth-field"><label htmlFor="auth-email">Email address</label><div className="auth-input-wrap"><span>✉</span><input id="auth-email" name="email" type="email" value={authForm.email} onChange={updateAuthField} placeholder="you@example.com" autoComplete="email" maxLength={254} required /></div></div>
            <div className="auth-field"><label htmlFor="auth-password">Password</label><div className="auth-input-wrap"><span>♙</span><input id="auth-password" name="password" type={showPassword ? "text" : "password"} value={authForm.password} onChange={updateAuthField} placeholder={authMode === "signup" ? "At least 8 characters" : "Enter your password"} autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={72} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div></div>
            <button className="auth-submit" type="submit" disabled={authLoading}>{authLoading ? <><span className="auth-spinner" /> Please wait...</> : <>{authMode === "signup" ? "Create account" : "Log in to TrustCart"} <span>→</span></>}</button>
          </form>
          <p className="auth-switch-copy">{authMode === "signup" ? "Already have an account?" : "New to TrustCart AI?"} <button type="button" onClick={() => switchAuthMode(authMode === "signup" ? "login" : "signup")}>{authMode === "signup" ? "Log in" : "Create an account"}</button></p>
          <p className="auth-privacy"><span>♢</span> Your password is securely hashed by the backend.</p>
        </section>
      </main>
      <footer className="auth-footer"><span>© TrustCart AI</span><span>Shop smarter <i>·</i> Review better <i>·</i> Trust your choice</span></footer>
    </div>
  );
}
