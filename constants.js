module.exports = {
  ALLOWED_CALLBACK_HOSTS_ARRAY: ['acode.app', ...(process.env.NODE_ENV === 'development' ? ['localhost:5500'] : [])],
};
