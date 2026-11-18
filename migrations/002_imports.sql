-- Field notes imports: the document a set of notes was split from, after names were replaced.
CREATE TABLE imports (LIKE sources INCLUDING ALL);
ALTER TABLE imports ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
