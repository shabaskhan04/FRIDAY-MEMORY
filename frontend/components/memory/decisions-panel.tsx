"use client";

import { useState, useEffect } from "react";
import { CheckSquare, ShieldCheck, HelpCircle, XCircle, Plus, Loader2, Sparkles, AlertCircle, FileText } from "lucide-react";
import { getDecisions, createDecision, evaluateDecision } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function DecisionsPanel() {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);

  // Create Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [decisionType, setDecisionType] = useState("GENERAL");
  const [reasoning, setReasoning] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [expectedProb, setExpectedProb] = useState(0.5);
  const [confidence, setConfidence] = useState(0.5);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Evaluate Form State
  const [evalSuccess, setEvalSuccess] = useState(true);
  const [evalSuccessScore, setEvalSuccessScore] = useState(1.0);
  const [evalAccuracyScore, setEvalAccuracyScore] = useState(0.8);
  const [evalLessons, setEvalLessons] = useState("");
  const [evalNotes, setEvalNotes] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);

  const fetchDecisions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getDecisions();
      setDecisions(data.decisions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decisions.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, []);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      await createDecision({
        title,
        description: description || undefined,
        decision_type: decisionType,
        reasoning: reasoning || undefined,
        expected_outcome: expectedOutcome || undefined,
        expected_success_probability: expectedProb,
        confidence_score: confidence,
        entity_node_ids: [],
      });
      setIsCreateOpen(false);
      // Reset
      setTitle("");
      setDescription("");
      setDecisionType("GENERAL");
      setReasoning("");
      setExpectedOutcome("");
      setExpectedProb(0.5);
      setConfidence(0.5);
      fetchDecisions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create decision.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEvaluateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evaluatingId) return;

    setIsEvaluating(true);
    try {
      await evaluateDecision(evaluatingId, {
        success: evalSuccess,
        success_score: evalSuccessScore,
        accuracy_score: evalAccuracyScore,
        lessons: evalLessons ? evalLessons.split(",").map(l => l.trim()).filter(Boolean) : [],
        notes: evalNotes || undefined,
      });
      setEvaluatingId(null);
      // Reset
      setEvalSuccess(true);
      setEvalSuccessScore(1.0);
      setEvalAccuracyScore(0.8);
      setEvalLessons("");
      setEvalNotes("");
      fetchDecisions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to evaluate decision.");
    } finally {
      setIsEvaluating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8 glass-card rounded-2xl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl glass-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Decision Tracker</h3>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          size="sm"
          className="h-8 px-2.5 text-xs flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Log Decision
        </Button>
      </div>

      {/* Decisions List */}
      {decisions.length === 0 ? (
        <div className="text-center py-6 text-xs text-muted-foreground/60 space-y-1">
          <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground/30 mb-1" />
          <p>No decisions logged yet.</p>
          <p>Track critical decisions to analyze outcomes and causal trends.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
          {decisions.map((dec) => {
            const isResolved = dec.status === "COMPLETED" || dec.evaluated_at;
            const successPct = dec.success_score !== null ? Math.round(dec.success_score * 100) : null;

            return (
              <div
                key={dec.id}
                className="group rounded-xl bg-secondary/20 hover:bg-secondary/35 border border-border/10 p-3.5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Badge variant={isResolved ? "success" : "warning"} className="text-[9px] uppercase font-bold tracking-wider">
                    {dec.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(dec.created_at).toLocaleDateString()}
                  </span>
                </div>

                <h4 className="text-sm font-semibold text-foreground mb-1 leading-snug">
                  {dec.title}
                </h4>
                {dec.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
                    {dec.description}
                  </p>
                )}

                {/* Outcome Stats */}
                <div className="grid grid-cols-2 gap-2 border-t border-border/10 pt-2.5 mt-2.5 text-[11px] text-muted-foreground">
                  <div>
                    <span className="text-muted-foreground/60">Expected success:</span>{" "}
                    <span className="font-bold text-foreground">
                      {Math.round(dec.expected_success_probability * 100)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">Type:</span>{" "}
                    <span className="font-bold text-foreground capitalize">
                      {dec.decision_type?.toLowerCase() || "General"}
                    </span>
                  </div>
                </div>

                {isResolved ? (
                  <div className="mt-2.5 p-2 bg-success/5 border border-success/15 rounded-lg flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-success font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>Outcome Resolved</span>
                    </div>
                    {successPct !== null && (
                      <span className="text-xs font-bold text-success">
                        {successPct}% success
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => setEvaluatingId(dec.id)}
                      className="h-7 px-3 text-[10px] bg-primary/80 hover:bg-primary"
                    >
                      Resolve Outcome
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Log Decision Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-card border border-border p-6 shadow-xl relative animate-fade-in">
            <h3 className="text-lg font-bold text-foreground mb-4">Log Decision</h3>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Hire someone for backend contract"
                  className="w-full rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Context and details..."
                  className="w-full h-16 rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Type</label>
                  <select
                    value={decisionType}
                    onChange={(e) => setDecisionType(e.target.value)}
                    className="w-full rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    <option value="GENERAL">General</option>
                    <option value="CAREER">Career</option>
                    <option value="FINANCIAL">Financial</option>
                    <option value="RELATIONSHIP">Relationship</option>
                    <option value="HEALTH">Health</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Confidence Score</label>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={confidence}
                      onChange={(e) => setConfidence(parseFloat(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <span className="text-xs font-bold text-foreground w-6">{Math.round(confidence * 100)}%</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Expected Outcome</label>
                <input
                  type="text"
                  value={expectedOutcome}
                  onChange={(e) => setExpectedOutcome(e.target.value)}
                  placeholder="What should happen if successful?"
                  className="w-full rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Expected Success Probability</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={expectedProb}
                    onChange={(e) => setExpectedProb(parseFloat(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <span className="text-xs font-bold text-foreground w-6">{Math.round(expectedProb * 100)}%</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  Log Decision
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evaluate Outcome Modal */}
      {evaluatingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-card border border-border p-6 shadow-xl relative animate-fade-in">
            <h3 className="text-lg font-bold text-foreground mb-4">Resolve Decision Outcome</h3>
            <form onSubmit={handleEvaluateSubmit} className="space-y-4">
              <div className="flex items-center justify-between p-2.5 bg-secondary/40 rounded-xl">
                <span className="text-xs font-semibold text-muted-foreground">Was it successful?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setEvalSuccess(true); setEvalSuccessScore(1.0); }}
                    className={`h-7 px-3 text-xs rounded-lg font-bold transition-all ${evalSuccess ? "bg-success text-success-foreground" : "bg-secondary/60 text-muted-foreground"}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEvalSuccess(false); setEvalSuccessScore(0.0); }}
                    className={`h-7 px-3 text-xs rounded-lg font-bold transition-all ${!evalSuccess ? "bg-destructive text-destructive-foreground" : "bg-secondary/60 text-muted-foreground"}`}
                  >
                    No
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Success Score</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={evalSuccessScore}
                      onChange={(e) => setEvalSuccessScore(parseFloat(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <span className="text-xs font-bold text-foreground w-6">{Math.round(evalSuccessScore * 100)}%</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">Predictive Accuracy</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={evalAccuracyScore}
                      onChange={(e) => setEvalAccuracyScore(parseFloat(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <span className="text-xs font-bold text-foreground w-6">{Math.round(evalAccuracyScore * 100)}%</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Lessons Learned</label>
                <input
                  type="text"
                  value={evalLessons}
                  onChange={(e) => setEvalLessons(e.target.value)}
                  placeholder="Lessons, comma-separated"
                  className="w-full rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={evalNotes}
                  onChange={(e) => setEvalNotes(e.target.value)}
                  placeholder="Outcome notes or feedback..."
                  className="w-full h-16 rounded-lg bg-secondary/40 border border-border/20 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" type="button" onClick={() => setEvaluatingId(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={isEvaluating}>
                  {isEvaluating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  Resolve
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
