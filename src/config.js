const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('Thiếu biến môi trường JWT_SECRET trong môi trường production');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-khong-dung-o-production',
  // Quy tắc nghiệp vụ của thư viện
  rules: {
    maxActiveLoans: 5, // số sách tối đa một độc giả được mượn cùng lúc
    loanDays: 14, // thời hạn mượn
    renewDays: 7, // số ngày được gia hạn (1 lần/phiếu)
    finePerDay: 2000, // phạt mỗi ngày trả trễ (VNĐ)
    lockAfterOverdueDays: 7, // quá hạn quá số ngày này thì khóa tài khoản độc giả cho đến khi trả sách và nộp đủ tiền phạt
  },
};
