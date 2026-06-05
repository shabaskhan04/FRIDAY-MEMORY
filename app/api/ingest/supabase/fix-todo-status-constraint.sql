-- Fix: todo_tasks status constraint used 'completed' but the app uses 'done'
-- Run this in: Supabase → SQL Editor → New Query → Paste → Run

-- Drop the old constraint
ALTER TABLE public.todo_tasks
  DROP CONSTRAINT IF EXISTS todo_tasks_status_check;

-- Re-add it with the correct values
ALTER TABLE public.todo_tasks
  ADD CONSTRAINT todo_tasks_status_check
  CHECK (status IN ('pending', 'done'));
