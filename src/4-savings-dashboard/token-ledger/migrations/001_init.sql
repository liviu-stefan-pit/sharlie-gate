CREATE TABLE IF NOT EXISTS price_snapshots(
  id INTEGER PRIMARY KEY, provider TEXT, model_pattern TEXT, input_e6 INTEGER, output_e6 INTEGER,
  cache_read_e6 INTEGER, cache_write_5m_e6 INTEGER, cache_write_1h_e6 INTEGER, min_cacheable INTEGER, effective_from TEXT
);
