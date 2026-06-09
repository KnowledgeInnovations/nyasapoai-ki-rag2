-- Run this once in your Supabase project: Dashboard → SQL Editor → New query

CREATE TABLE IF NOT EXISTS tenant_categories (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  value       text NOT NULL,
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_name   text NOT NULL DEFAULT 'folder',
  color_name  text NOT NULL DEFAULT 'blue',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, value)
);

ALTER TABLE tenant_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_tenant_categories"
  ON tenant_categories FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "senior_middle_write_tenant_categories"
  ON tenant_categories FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM memberships
      WHERE user_id = auth.uid() AND role IN ('senior', 'middle')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM memberships
      WHERE user_id = auth.uid() AND role IN ('senior', 'middle')
    )
  );

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_categories_updated_at
  BEFORE UPDATE ON tenant_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
