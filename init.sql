CREATE ROLE appuser LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE marketplace TO appuser;