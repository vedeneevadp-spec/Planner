alter table app.chaos_inbox_items
  add column product_url text
    check (char_length(product_url) <= 8192 and product_url ~* '^https?://[^[:space:]]+$');
