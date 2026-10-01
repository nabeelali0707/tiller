const { normalize } = require('./normalize.cjs');
exports.lookup = (users, email) => users.find((user) => user.email === normalize(email));
