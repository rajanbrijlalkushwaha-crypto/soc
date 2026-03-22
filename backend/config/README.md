# backend/config/

## paths.js
Single source of truth for all filesystem paths.

Import it everywhere instead of building paths inline:

```js
const { PATHS } = require('./config/paths');   // from server.js
const { PATHS } = require('../config/paths');  // from api/
const { PATHS } = require('../../config/paths'); // from services/

// Read a user profile
const profile = JSON.parse(fs.readFileSync(path.join(PATHS.USERS, `${userId}.json`)));

// Write option chain snapshot
fs.writeFileSync(path.join(PATHS.MARKET, 'NIFTY', filename), data);

// Session store
new FileStore({ path: PATHS.SESSIONS })
```

## .env keys consumed by paths.js
```
DATA_ROOT=/home/ubuntu/soc/data
```
