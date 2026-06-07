// ============================================================
// observation-classifier.ts — Rule-based multi-label classifier
// No LLM calls. Pure lookup + keyword matching.
// ============================================================
import type { ObservationSource, ObservationCategory, ClassificationResult } from './observation.types';

// Source → primary category (deterministic)
const SOURCE_CATEGORY: Record<ObservationSource, ObservationCategory> = {
  MANUAL:                 'PERSONAL',
  GIT_COMMIT:             'WORK',
  GIT_PR:                 'WORK',
  GIT_BRANCH:             'WORK',
  EMAIL_SENT:             'WORK',
  EMAIL_RECEIVED:         'WORK',
  CALENDAR_EVENT:         'WORK',
  TASK_CREATED:           'PROJECT',
  TASK_COMPLETED:         'PROJECT',
  FILE_CREATED:           'WORK',
  FILE_MODIFIED:          'WORK',
  FILE_DELETED:           'WORK',
  HEALTH_UPDATE:          'HEALTH',
  APP_USAGE:              'SYSTEM',
  WEBSITE_VISIT:          'PERSONAL',
  DEVICE_ACTIVITY:        'SYSTEM',
  DOCUMENT_CREATED:       'WORK',
  DOCUMENT_UPDATED:       'WORK',
  RESEARCH_SESSION:       'LEARNING',
  YOUTUBE_WATCH:          'LEARNING',
  BOOK_READING:           'LEARNING',
  COURSE_PROGRESS:        'LEARNING',
  FINANCIAL_TRANSACTION:  'FINANCE',
  REVENUE_EVENT:          'FINANCE',
  EXPENSE_EVENT:          'FINANCE',
  PROJECT_MILESTONE:      'PROJECT',
  SOCIAL_INTERACTION:     'SOCIAL',
  PHONE_CALL:             'SOCIAL',
  MESSAGE_SENT:           'SOCIAL',
  MESSAGE_RECEIVED:       'SOCIAL',
  CUSTOM:                 'PERSONAL',
};

// Sources that commonly carry secondary labels
const SECONDARY_CATEGORIES: Partial<Record<ObservationSource, ObservationCategory[]>> = {
  GIT_COMMIT:       ['PROJECT'],
  GIT_PR:           ['PROJECT'],
  CALENDAR_EVENT:   ['PERSONAL'],
  TASK_COMPLETED:   ['WORK'],
  TASK_CREATED:     ['WORK'],
  PROJECT_MILESTONE:['WORK'],
  RESEARCH_SESSION: ['WORK'],
  YOUTUBE_WATCH:    ['PERSONAL'],
  BOOK_READING:     ['PERSONAL'],
  REVENUE_EVENT:    ['WORK', 'PROJECT'],
  EXPENSE_EVENT:    ['WORK'],
  PHONE_CALL:       ['WORK'],
  EMAIL_SENT:       ['SOCIAL'],
};

// Keyword → additional category hints derived from title/description
const KEYWORD_HINTS: Array<{ keywords: RegExp; category: ObservationCategory }> = [
  { keywords: /\b(orin|static|khan designs|chai|wedee|lxv)\b/i, category: 'PROJECT' },
  { keywords: /\b(gym|workout|body fat|weight|calories|sleep|steps|health)\b/i, category: 'HEALTH' },
  { keywords: /\b(revenue|invoice|payment|expense|profit|income|salary)\b/i, category: 'FINANCE' },
  { keywords: /\b(course|tutorial|book|read|study|learn|lecture)\b/i, category: 'LEARNING' },
  { keywords: /\b(meeting|call|nidha|client|friend|family|dinner)\b/i, category: 'SOCIAL' },
];

export class ObservationClassifier {
  classify(
    source: ObservationSource,
    title: string,
    description: string | null = null,
  ): ClassificationResult {
    const primary = SOURCE_CATEGORY[source] ?? 'PERSONAL';
    const categories = new Set<ObservationCategory>([primary]);

    // Secondary from source type
    for (const cat of SECONDARY_CATEGORIES[source] ?? []) {
      categories.add(cat);
    }

    // Keyword hints from text
    const text = `${title} ${description ?? ''}`;
    for (const { keywords, category } of KEYWORD_HINTS) {
      if (keywords.test(text)) categories.add(category);
    }

    return {
      categories:       Array.from(categories),
      primary_category: primary,
      confidence:       this.deriveConfidence(source, categories.size),
    };
  }

  private deriveConfidence(source: ObservationSource, labelCount: number): number {
    // MANUAL observations have lower classification certainty (free-form text)
    // Structured sources (git, health, finance) are high confidence
    const BASE: Partial<Record<ObservationSource, number>> = {
      GIT_COMMIT: 0.97, GIT_PR: 0.97, GIT_BRANCH: 0.95,
      HEALTH_UPDATE: 0.97,
      REVENUE_EVENT: 0.97, EXPENSE_EVENT: 0.97, FINANCIAL_TRANSACTION: 0.95,
      TASK_COMPLETED: 0.95, TASK_CREATED: 0.9,
      PROJECT_MILESTONE: 0.95,
      MANUAL: 0.70,
    };
    const base = BASE[source] ?? 0.80;
    // Slight penalty per extra label (more labels = more ambiguity)
    return Math.max(0.5, base - (labelCount - 1) * 0.02);
  }
}
