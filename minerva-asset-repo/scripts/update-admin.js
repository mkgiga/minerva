db.users.updateOne(
  { email: 'sourcemile@gmail.com' },
  { $set: { role: 'admin' } }
);