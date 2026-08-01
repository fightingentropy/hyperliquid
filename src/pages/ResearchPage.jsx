import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  FileSearch,
  History,
  Info,
  Minus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { runEquityResearch } from "../api/equityResearch";
import EquityResearchChart from "../components/EquityResearchChart";
import {
  clearResearchHistory,
  getResearchHistory,
  recordResearchRun,
} from "../lib/equityResearchHistory";
import { todayIso } from "../lib/equityResearch";

const EXAMPLE_TICKERS = ["TSLA", "AAPL", "NVDA"];
const FACTOR_LABELS = {
  relative_momentum_20d: "20D excess momentum",
  relative_momentum_5d: "5D excess momentum",
  absolute_momentum_20d: "20D absolute momentum",
  drawdown_risk: "Drawdown risk",
  volume_confirmation: "Volume confirmation",
};

export default function ResearchPage() {
  const [ticker, setTicker] = useState("TSLA");
  const [asOf, setAsOf] = useState(todayIso);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(getResearchHistory);
  const abortRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Equity Research · Hyperliquid";

    return () => {
      abortRef.current?.abort();
      document.title = previousTitle;
    };
  }, []);

  const analyze = async (tickerOverride) => {
    const nextTicker = String(tickerOverride ?? ticker).trim().toUpperCase();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTicker(nextTicker);
    setLoading(true);
    setError(null);

    try {
      const payload = await runEquityResearch({
        ticker: nextTicker,
        asOf,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      setResult(payload);
      setHistory(recordResearchRun(payload));
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }

      setError({
        code: caught?.code ?? "research_error",
        message: caught instanceof Error ? caught.message : "The research request failed.",
      });
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    void analyze();
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleUseHistory = (run) => {
    setTicker(run.ticker);
    setAsOf(run.as_of);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClearHistory = () => {
    if (!window.confirm("Clear equity-research history from this browser?")) {
      return;
    }

    clearResearchHistory();
    setHistory([]);
  };

  return (
    <div className="qf-research">
      <section className="qf-research-intro">
        <div>
          <p className="qf-research-eyebrow">As-of-filtered equity research</p>
          <h2 className="qf-research-heading">A transparent signal, not a black box.</h2>
          <p className="qf-research-lede">
            The original AI Hedge Fund market model is now a native Hyperliquid tool:
            same fixed factor weights, same SPY benchmark, and the same research-only
            boundary—rebuilt for Cloudflare.
          </p>
        </div>
        <div className="qf-research-model-badge">
          <BrainCircuit aria-hidden="true" />
          <span>
            <strong>market-factor-v1</strong>
            <small>Deterministic · 20 sessions</small>
          </span>
        </div>
      </section>

      <form className="qf-research-form" onSubmit={handleSubmit}>
        <label className="qf-research-field">
          <span>Security</span>
          <span className="qf-research-input-wrap">
            <Search aria-hidden="true" />
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder="TSLA"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Security ticker"
            />
          </span>
        </label>

        <label className="qf-research-field">
          <span>As of</span>
          <input
            type="date"
            value={asOf}
            max={todayIso()}
            onChange={(event) => setAsOf(event.target.value)}
            aria-label="Research as-of date"
          />
        </label>

        <div className="qf-research-field qf-research-field--model">
          <span>Analyst</span>
          <div className="qf-research-readonly-field">
            Market factor <small>20 sessions</small>
          </div>
        </div>

        <button className="qf-research-submit" type="submit" disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="is-spinning" aria-hidden="true" />
              Analyzing
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" />
              Analyze
            </>
          )}
        </button>
      </form>

      {loading ? (
        <ResearchLoading ticker={ticker} asOf={asOf} onCancel={handleCancel} />
      ) : error ? (
        <ResearchError error={error} onRetry={() => void analyze()} />
      ) : result ? (
        <ResearchResult result={result} />
      ) : (
        <ResearchEmpty onExample={(example) => void analyze(example)} />
      )}

      <ResearchHistory
        history={history}
        onUse={handleUseHistory}
        onClear={handleClearHistory}
      />
    </div>
  );
}

function ResearchResult({ result }) {
  const direction = result.factor_model.direction;
  const score = result.analysis.value;
  const rawScore = result.factor_model.raw_score;
  const evidence = result.evidence;

  return (
    <div className="qf-research-results">
      <section className="qf-research-hero">
        <div className={`qf-research-signal is-${direction}`}>
          <div className="qf-research-signal__topline">
            <p>{result.analysis.ticker} · Market factor</p>
            <span>Research only</span>
          </div>
          <div className="qf-research-direction">
            <DirectionIcon direction={direction} />
            <strong>{direction}</strong>
          </div>
          <div className="qf-research-score">
            <strong>{formatScore(score)}</strong>
            <span>
              Strength {result.factor_model.strength}/100
              <small>Score magnitude, not probability</small>
            </span>
          </div>
          <div className="qf-research-score-track">
            <span
              style={{ width: `${Math.min(100, result.factor_model.strength)}%` }}
            />
          </div>
        </div>

        <div className="qf-research-price-panel">
          <div className="qf-research-panel-heading">
            <span>
              <small>Relative performance</small>
              <strong>
                {result.analysis.ticker} vs {result.forecast.benchmark}
              </strong>
            </span>
            <span className="qf-research-chart-legend">
              <i className="is-ticker" />
              {result.analysis.ticker}
              <i className="is-benchmark" />
              {result.forecast.benchmark}
            </span>
          </div>
          <EquityResearchChart
            tickerSeries={result.series.ticker}
            benchmarkSeries={result.series.benchmark}
            ticker={result.analysis.ticker}
            benchmark={result.forecast.benchmark}
          />
        </div>

        <div className="qf-research-method-strip">
          <MethodItem label="Forecast" value="20 sessions" />
          <MethodItem label="Target" value={`Return vs ${result.forecast.benchmark}`} />
          <MethodItem label="Model" value={result.factor_model.factor_model_version} />
          <MethodItem
            label="Neutral band"
            value={`±${result.factor_model.neutral_deadband.toFixed(2)}`}
          />
        </div>
      </section>

      <div className="qf-research-layout">
        <div className="qf-research-main-column">
          <section className="qf-research-card">
            <SectionHeading icon={BrainCircuit} eyebrow="Interpretation" title="Why this result" />
            <div className="qf-research-narrative">
              <div>
                <span>Deterministic read</span>
                <p>{result.analysis.reasoning}</p>
              </div>
              <div className="qf-research-narrative__boundary">
                <ShieldCheck aria-hidden="true" />
                <span>
                  The calculation is fixed and auditable. It cannot place trades,
                  change positions, or infer a probability of success.
                </span>
              </div>
            </div>
          </section>

          <section className="qf-research-card">
            <SectionHeading
              icon={SlidersHorizontal}
              eyebrow="Attribution"
              title="Factor contributions"
              aside={`Raw score ${formatScore(rawScore)}`}
            />
            <div className="qf-factor-list">
              {result.factor_model.factors.map((factor) => (
                <FactorRow key={factor.name} factor={factor} />
              ))}
            </div>
          </section>

          <section className="qf-research-card">
            <SectionHeading
              icon={BarChart3}
              eyebrow="Market evidence"
              title="What the model saw"
              aside={`Through ${formatDate(evidence.latest_price_date)}`}
            />
            <div className="qf-research-evidence-grid">
              <EvidenceMetric label="5D return" value={formatPercent(evidence.return_5d)} />
              <EvidenceMetric label="20D return" value={formatPercent(evidence.return_20d)} />
              <EvidenceMetric
                label="20D excess"
                value={formatPercent(evidence.relative_return_20d)}
              />
              <EvidenceMetric
                label="20D volatility"
                value={formatPercent(evidence.annualized_volatility_20d)}
              />
              <EvidenceMetric
                label={`${evidence.drawdown_lookback_sessions ?? 60}D drawdown`}
                value={formatPercent(evidence.drawdown_from_60d_high)}
              />
              <EvidenceMetric
                label="Volume / 20D"
                value={formatMultiple(evidence.latest_volume_vs_20d_avg)}
              />
            </div>
          </section>

          <HeadlineLedger headlines={evidence.headlines} warnings={result.warnings} />
        </div>

        <aside className="qf-research-side-column">
          <section className="qf-research-card">
            <SectionHeading icon={Database} eyebrow="Audit trail" title="Run provenance" />
            <dl className="qf-research-audit">
              <AuditRow label="Run" value={shortId(result.run.run_id)} />
              <AuditRow label="Generated" value={formatDateTime(result.run.generated_at)} />
              <AuditRow label="As of" value={formatDate(result.analysis.date)} />
              <AuditRow label="Price through" value={formatDate(evidence.latest_price_date)} />
              <AuditRow label="Provider" value={result.run.data_provider.toUpperCase()} />
              <AuditRow
                label="Factor coverage"
                value={formatPercent(result.factor_model.evidence_coverage)}
              />
              <AuditRow
                label="Drawdown window"
                value={`${evidence.drawdown_lookback_sessions ?? 60} sessions`}
              />
            </dl>
          </section>

          <section className="qf-research-boundary">
            <Info aria-hidden="true" />
            <div>
              <strong>Decision boundary</strong>
              <p>
                This is educational research, not investment advice or execution.
                Historical provider data can be revised, and no live position or
                portfolio action is taken.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ResearchEmpty({ onExample }) {
  return (
    <section className="qf-research-empty">
      <div className="qf-research-empty__icon">
        <FileSearch aria-hidden="true" />
      </div>
      <p className="qf-research-eyebrow">Start an as-of-filtered analysis</p>
      <h3>Research a public company</h3>
      <p>
        Five documented price and volume factors produce a tactical view relative
        to SPY. The score is deterministic and every contribution stays visible.
      </p>
      <div className="qf-research-example-row">
        {EXAMPLE_TICKERS.map((example) => (
          <button type="button" key={example} onClick={() => onExample(example)}>
            Analyze {example}
          </button>
        ))}
      </div>
      <div className="qf-research-feature-row">
        <TinyFeature icon={Clock3} label="As-of filtered" />
        <TinyFeature icon={SlidersHorizontal} label="Auditable factors" />
        <TinyFeature icon={ShieldCheck} label="Server-side keys" />
      </div>
    </section>
  );
}

function ResearchLoading({ ticker, asOf, onCancel }) {
  return (
    <section className="qf-research-loading" aria-live="polite">
      <div>
        <p className="qf-research-eyebrow">
          Analyzing {ticker} · {formatDate(asOf)}
        </p>
        <h3>Fetching point-in-time price evidence</h3>
        <p>The fixed signal is calculated after both the ticker and SPY series arrive.</p>
      </div>
      <button type="button" onClick={onCancel}>
        Stop waiting
      </button>
      <div className="qf-research-loading-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function ResearchError({ error, onRetry }) {
  const isSetup = error.code === "provider_not_configured";

  return (
    <section className="qf-research-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <div>
        <p className="qf-research-eyebrow">{isSetup ? "Provider setup" : "Research unavailable"}</p>
        <h3>{isSetup ? "Connect EODHD to Cloudflare" : "The analysis could not run"}</h3>
        <p>{error.message}</p>
        {isSetup ? (
          <code>npx wrangler pages secret put EODHD_API_TOKEN --project-name=hl-stats</code>
        ) : null}
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </button>
      </div>
    </section>
  );
}

function ResearchHistory({ history, onUse, onClear }) {
  return (
    <section className="qf-research-history">
      <div className="qf-research-history__header">
        <div>
          <p className="qf-research-eyebrow">Local research index</p>
          <h3>Recent runs</h3>
          <p>Safe summaries are stored in this browser; provider keys never are.</p>
        </div>
        {history.length ? (
          <button type="button" onClick={onClear} className="qf-research-history__clear">
            <Trash2 aria-hidden="true" />
            Clear
          </button>
        ) : null}
      </div>

      {history.length ? (
        <div className="qf-research-history__list">
          {history.slice(0, 8).map((run) => (
            <button
              type="button"
              key={run.run_id}
              className="qf-research-history-row"
              onClick={() => onUse(run)}
            >
              <DirectionIcon direction={run.direction} />
              <span>
                <strong>{run.ticker}</strong>
                <small>{run.direction}</small>
              </span>
              <span className="qf-research-history-row__date">
                {formatDate(run.as_of)}
              </span>
              <strong className="qf-research-history-row__score">
                {formatScore(run.score)}
              </strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="qf-research-history__empty">
          <History aria-hidden="true" />
          Completed research runs will appear here.
        </div>
      )}
    </section>
  );
}

function HeadlineLedger({ headlines = [], warnings = [] }) {
  return (
    <section className="qf-research-card">
      <SectionHeading
        icon={BookOpen}
        eyebrow="Public context"
        title="Headline evidence"
        aside={`${headlines.length} items`}
      />
      <p className="qf-research-disclaimer">
        Titles are unverified provider metadata. They do not affect the fixed score.
      </p>
      {warnings.map((warning) => (
        <p className="qf-research-warning" key={warning}>
          {warning}
        </p>
      ))}
      {headlines.length ? (
        <div className="qf-headline-list">
          {headlines.map((headline, index) => (
            <article key={`${headline.date}-${headline.title}-${index}`}>
              <time>{formatDate(headline.date)}</time>
              <div>
                {headline.url ? (
                  <a href={headline.url} target="_blank" rel="noreferrer noopener">
                    {headline.title}
                    <ExternalLink aria-hidden="true" />
                  </a>
                ) : (
                  <strong>{headline.title}</strong>
                )}
                <small>
                  {headline.source}
                  {headline.ticker_relevant === false
                    ? " · relevance unconfirmed"
                    : ""}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="qf-research-card-empty">
          No dated headlines were returned inside the evidence window.
        </p>
      )}
    </section>
  );
}

function FactorRow({ factor }) {
  const contribution = factor.contribution;
  const width = Math.min(100, (Math.abs(contribution) / 0.4) * 100);
  const tone = contribution > 0 ? "positive" : contribution < 0 ? "negative" : "neutral";

  return (
    <div className="qf-factor-row">
      <div className="qf-factor-row__heading">
        <span>
          <strong>{FACTOR_LABELS[factor.name] ?? factor.name}</strong>
          <small>{Math.round(factor.weight * 100)}% weight</small>
        </span>
        <strong className={`is-${tone}`}>{formatScore(contribution)}</strong>
      </div>
      <div className="qf-factor-track">
        <i />
        <span className={`is-${tone}`} style={{ width: `${width}%` }} />
      </div>
      <p>{factor.description}</p>
    </div>
  );
}

function DirectionIcon({ direction }) {
  const Icon =
    direction === "bullish" ? ArrowUp : direction === "bearish" ? ArrowDown : Minus;
  return (
    <span className={`qf-direction-icon is-${direction}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}

function SectionHeading({ icon: Icon, eyebrow, title, aside }) {
  return (
    <div className="qf-research-section-heading">
      <span className="qf-research-section-heading__icon">
        <Icon aria-hidden="true" />
      </span>
      <span>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
      </span>
      {aside ? <em>{aside}</em> : null}
    </div>
  );
}

function MethodItem({ label, value }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceMetric({ label, value }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function AuditRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TinyFeature({ icon: Icon, label }) {
  return (
    <span>
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}

function formatScore(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0005) {
    return "0.00";
  }
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
}

function formatMultiple(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}×` : "—";
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortId(value) {
  return String(value ?? "").split("-")[0] || "—";
}
