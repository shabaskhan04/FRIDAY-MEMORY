// ============================================================
// observation-classifier.ts — Rule-based multi-label classifier
// Rule #2, #3, #10
// ============================================================
import type { ObservationSource, ObservationCategory, ClassificationResult } from './observation.types';
import type { AIRouter } from '../ai-engine/ai-router';

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

// Keyword → additional category hints derived from title/description (fallback)
const KEYWORD_HINTS: Array<{ keywords: RegExp; category: ObservationCategory }> = [
  {
    keywords: /\b(work|worked|working|works|job|jobs|office|employee|employees|colleague|colleagues|task|tasks|todo|todos|refactor|refactored|refactoring|integration|integrations|compiler|build|builds|dependency|dependencies|code|codes|coding|develop|developed|developing|development|programming|software|server|servers|deploy|deployed|deploying|deployment|api|apis|auth|router|routers|database|databases|query|queries|fix|fixed|fixing|bug|bugs|engineering|design|designs|gateway|gateways|classifier|classifiers|backend|frontend|interface|interfaces|component|components|wire|wired|wiring|resume|career|hiring|interview|contract|manager|scrum|sprint|jira|git|github|gitlab|pr|commit|merge|codebase|testing|test|unittest|qa|production|staging)\b/i,
    category: 'WORK'
  },
  {
    keywords: /\b(orin|static|khan designs|chai|wedee|lxv|friday|project|projects|milestone|milestones|launch|launched|launching|beta|ship|shipped|shipping|release|released|releasing|business|startup|pitch|venture|entrepreneur|strategy|marketing|sales|roadmap|timeline|deadline|deliverable|deliverables|mvp|product|features|epic|backlog)\b/i,
    category: 'PROJECT'
  },
  {
    keywords: /\b(gym|workout|workouts|body fat|weight|calories|sleep|steps|health|healthy|exercise|exercises|run|running|fitness|doctor|doctors|medical|medicine|medicines|diet|nutrition|clinic|hospital|physician|dentist|therapy|mental|meditation|yoga|cardio|training|sick|fever|pain|illness|symptoms|prescription|vitamins|supplement|supplements|stretching|hydration|water)\b/i,
    category: 'HEALTH'
  },
  {
    keywords: /\b(revenue|revenues|invoice|invoices|payment|payments|expense|expenses|profit|profits|income|salary|salaries|money|cost|costs|spend|spending|spent|price|prices|finance|finances|transaction|transactions|bank|banking|card|cards|crypto|paid|receipt|receipts|billing|subscription|buy|bought|purchase|purchases|purchased|tax|taxes|invest|investment|investing|stock|stocks|portfolio|cash|wallet|budget|budgeting)\b/i,
    category: 'FINANCE'
  },
  {
    keywords: /\b(course|tutorials|book|books|read|reading|reads|study|studying|learn|learned|learning|learns|lecture|lectures|class|classes|lesson|lessons|education|school|schools|university|college|colleges|exam|exams|research|researching|researched|tutorial|homework|assignment|assignments|syllabus|grade|grades|coursework|textbook|certification|degree|thesis|academic|journal|paper|papers|concept|concepts|skill|skills|workshop|webinar)\b/i,
    category: 'LEARNING'
  },
  {
    keywords: /\b(meeting|meetings|call|calls|nidha|client|clients|friend|friends|family|dinner|dinners|lunch|lunches|breakfast|breakfasts|party|parties|hangout|hangouts|chat|chats|social|meetup|meetups|relationship|relationships|date|dates|parents|brother|sister|wife|husband|girlfriend|boyfriend|spouse|cousin|cousins|talk|talked|talking|gathering|event|events|wedding|anniversary|birthday)\b/i,
    category: 'SOCIAL'
  },
  {
    keywords: /\b(system|systems|device|devices|os|windows|mac|linux|cpu|ram|storage|network|networks|wifi|internet|browser|browsers|chrome|firefox|safari|ide|editor|editors|reboot|restart|hardware|app|apps|install|installed|installing|update|updates|updating|configuration|settings|keyboard|mouse|monitor|screen|disk|memory|performance|process|processes|terminal|console|driver|drivers)\b/i,
    category: 'SYSTEM'
  },
];

// Priority of domains for selecting the primary category
const PRIORITY_ORDER: ObservationCategory[] = [
  'WORK',
  'PROJECT',
  'HEALTH',
  'FINANCE',
  'LEARNING',
  'SOCIAL',
  'SYSTEM',
];

export class ObservationClassifier {
  constructor(private readonly aiRouter?: AIRouter) {}

  classify(
    source: ObservationSource,
    title: string,
    description: string | null = null,
  ): ClassificationResult {
    const matched = new Set<ObservationCategory>();

    // 1. Add primary category from source
    const sourceCat = SOURCE_CATEGORY[source];
    if (sourceCat) {
      matched.add(sourceCat);
    }

    // 2. Add secondary categories from source
    for (const cat of SECONDARY_CATEGORIES[source] ?? []) {
      matched.add(cat);
    }

    // 3. Add matched categories from keywords
    const text = `${title} ${description ?? ''}`;
    for (const { keywords, category } of KEYWORD_HINTS) {
      if (keywords.test(text)) {
        matched.add(category);
      }
    }

    // Drop PERSONAL if any other category is matched
    const hasOtherCategory = Array.from(matched).some(cat => cat !== 'PERSONAL');
    if (hasOtherCategory) {
      matched.delete('PERSONAL');
    }

    let primaryCategory: ObservationCategory;
    let categoriesList: ObservationCategory[];

    if (matched.size > 0) {
      categoriesList = Array.from(matched);
      const naturalCat = SOURCE_CATEGORY[source];
      if (naturalCat && naturalCat !== 'PERSONAL' && matched.has(naturalCat)) {
        primaryCategory = naturalCat;
      } else {
        primaryCategory = PRIORITY_ORDER.find(c => matched.has(c)) ?? categoriesList[0];
      }
    } else {
      primaryCategory = 'PERSONAL';
      categoriesList = ['PERSONAL'];
    }

    return {
      categories:       categoriesList,
      primary_category: primaryCategory,
      confidence:       this.deriveConfidence(source, categoriesList.length),
    };
  }

  private deriveConfidence(source: ObservationSource, labelCount: number): number {
    const BASE: Partial<Record<ObservationSource, number>> = {
      GIT_COMMIT: 0.97, GIT_PR: 0.97, GIT_BRANCH: 0.95,
      HEALTH_UPDATE: 0.97,
      REVENUE_EVENT: 0.97, EXPENSE_EVENT: 0.97, FINANCIAL_TRANSACTION: 0.95,
      TASK_COMPLETED: 0.95, TASK_CREATED: 0.9,
      PROJECT_MILESTONE: 0.95,
      MANUAL: 0.70,
    };
    const base = BASE[source] ?? 0.80;
    return Math.max(0.5, base - (labelCount - 1) * 0.02);
  }
}
