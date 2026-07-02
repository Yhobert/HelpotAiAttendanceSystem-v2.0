USE helportai_attendance;
INSERT INTO users (username, password, role) VALUES
('Admin', '$2y$10$/2vX1w3.jxjVJVpI9Q79LuAkzF7Y.2ES2pneBc5.mRbyqY/9KW6Hy', 'admin'),
('User', '$2y$10$UG0znNzfx8Kc37JPsckGM.N2p19kkF8qpFvLtpLItoKeq.L7Bmv4m', 'user')
ON DUPLICATE KEY UPDATE password = VALUES(password), role = VALUES(role);
