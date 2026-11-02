CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  full_name     VARCHAR(100) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('admin', 'reader')),
  card_code     VARCHAR(20)  UNIQUE,
  phone         VARCHAR(20),
  email         VARCHAR(100),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id               SERIAL PRIMARY KEY,
  isbn             VARCHAR(20) UNIQUE,
  title            VARCHAR(200) NOT NULL,
  author           VARCHAR(120) NOT NULL,
  category         VARCHAR(60)  NOT NULL,
  publish_year     INT,
  total_copies     INT NOT NULL CHECK (total_copies >= 0),
  available_copies INT NOT NULL CHECK (available_copies >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available_copies <= total_copies)
);

CREATE TABLE IF NOT EXISTS loans (
  id          SERIAL PRIMARY KEY,
  user_id     INT  NOT NULL REFERENCES users(id),
  book_id     INT  NOT NULL REFERENCES books(id),
  borrowed_at DATE NOT NULL,
  due_date    DATE NOT NULL,
  returned_at DATE,
  renewed     BOOLEAN NOT NULL DEFAULT false,
  fine_amount INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_loans_user   ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_book   ON loans(book_id);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(due_date) WHERE returned_at IS NULL;
