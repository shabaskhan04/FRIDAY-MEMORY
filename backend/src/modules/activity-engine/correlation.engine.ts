// ============================================================
// correlation.engine.ts — Group observations into activity clusters
// No LLM. Pure time + entity + category proximity.
// ============================================================
import type { Observation, ObservationCategory } from '../observation-engine/observation.types';
import type { ObservationCluster, ActivityCandidate } from './activity.types';
import { getSignalQuality, clusterSignalQuality, scoreActivity } from './activity.scoring';

// ---- Tuning constants ------------------------------------

/** Max gap between observations to remain in the same cluster (minutes) */
const GAP_THRESHOLD_MINS = 30;

/** Noise-tier sources are excluded from cluster formation but logged */
const NOISE_SOURCES = new Set(['DEVICE_ACTIVITY', 'APP_USAGE']);

// ---- Title generation rules (deterministic) --------------

const CATEGORY_TITLES: Record<string, string> = {
  WORK:     'Work Session',
  PROJECT:  'Project Work',
  HEALTH:   'Health Activity',
  LEARNING: 'Learning Session',
  SOCIAL:   'Social Interaction',
  FINANCE:  'Financial Activity',
  PERSONAL: 'Personal Activity',
  SYSTEM:   'System Activity',
};

/** Derive a human title from cluster entities + category */
function deriveTitle(cluster: ObservationCluster): string {
  if (cluster.entities.length === 1) {
    return `${CATEGORY_TITLES[cluster.dominant_category] ?? 'Activity'} · ${cluster.entities[0]}`;
  }
  if (cluster.entities.length >= 2) {
    return `${cluster.entities.slice(0, 2).join(' + ')} · ${CATEGORY_TITLES[cluster.dominant_category] ?? 'Work'}`;
  }

  // Fall back to most informative observation title
  const best = cluster.observations
    .filter(o => !NOISE_SOURCES.has(o.source))
    .sort((a, b) => b.importance_score - a.importance_score)[0];
  return best?.title ?? CATEGORY_TITLES[cluster.dominant_category] ?? 'Activity';
}

// ---- Dominant category -----------------------------------

function dominantCategory(obs: Observation[]): ObservationCategory {
  const counts: Record<string, number> = {};
  for (const o of obs) {
    for (const cat of o.categories) {
      counts[cat] = (counts[cat] ?? 0) + (getSignalQuality(o.source).score);
    }
  }
  return (Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'PERSONAL') as ObservationCategory;
}

// ---- Core correlation engine -----------------------------

export class CorrelationEngine {

  /**
   * correlate() — main entry point.
   *
   * Algorithm:
   * 1. Sort observations by occurred_at.
   * 2. Drop noise-tier observations.
   * 3. Split into clusters whenever the gap between consecutive observations
   *    exceeds GAP_THRESHOLD_MINS.
   * 4. Within each time window, merge clusters that share entities.
   * 5. Score each cluster and return ActivityCandidates.
   */
  correlate(observations: Observation[]): ActivityCandidate[] {
    const filtered = observations
      .filter(o => getSignalQuality(o.source).tier !== 'NOISE')
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

    if (!filtered.length) return [];

    const timeClusters = this.splitByTime(filtered);
    const merged       = timeClusters.flatMap(c => this.mergeByEntity(c));
    return merged.map(cluster => this.toCandidate(cluster));
  }

  // ---- Step 1: time-based splitting ----------------------

  private splitByTime(sorted: Observation[]): ObservationCluster[] {
    const clusters: ObservationCluster[] = [];
    let current: Observation[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].occurred_at).getTime();
      const curr = new Date(sorted[i].occurred_at).getTime();
      const gapMins = (curr - prev) / 60_000;

      if (gapMins > GAP_THRESHOLD_MINS) {
        clusters.push(this.buildCluster(current));
        current = [sorted[i]];
      } else {
        current.push(sorted[i]);
      }
    }
    clusters.push(this.buildCluster(current));
    return clusters;
  }

  // ---- Step 2: entity-based merging within time window ---
  // Splits a time cluster into sub-clusters by shared entity sets.
  // Observations with no entities are kept in their own sub-cluster.

  private mergeByEntity(cluster: ObservationCluster): ObservationCluster[] {
    // H-3: O(n) inverted entity→group index instead of O(n²) nested find
    const groups: Observation[][] = [];
    const entityToGroup = new Map<string, Observation[]>();

    for (const obs of cluster.observations) {
      const entities = obs.related_entities.map(e => e.toLowerCase());
      let group = entities.map(e => entityToGroup.get(e)).find(Boolean);
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(obs);
      for (const e of entities) entityToGroup.set(e, group);
    }

    return groups.length === 1 ? [cluster] : groups.map(g => this.buildCluster(g));
  }

  // ---- Helpers -------------------------------------------

  private buildCluster(obs: Observation[]): ObservationCluster {
    const times    = obs.map(o => new Date(o.occurred_at).getTime());
    const entities = [...new Set(obs.flatMap(o => o.related_entities))];
    const category = dominantCategory(obs);
    const cluster: ObservationCluster = {
      observations:      obs,
      start_time:        new Date(Math.min(...times)),
      end_time:          new Date(Math.max(...times)),
      dominant_category: category,
      entities,
      avg_signal_quality: 0,
    };
    cluster.avg_signal_quality = clusterSignalQuality(cluster);
    return cluster;
  }

  private toCandidate(cluster: ObservationCluster): ActivityCandidate {
    const { importance_score, confidence_score, signal_quality } = scoreActivity(cluster);
    return {
      cluster,
      title:            deriveTitle(cluster),
      category:         cluster.dominant_category,
      importance_score,
      confidence_score,
      signal_quality,
    };
  }
}
