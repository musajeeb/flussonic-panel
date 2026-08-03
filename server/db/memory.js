import crypto from 'node:crypto';

/**
 * Minimal in-memory repository implementing the same contract as the Mongo driver.
 * Used by the automated tests and by DB_DRIVER=memory demo mode.
 */
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    if (v === undefined) return true;
    if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(doc[k]));
    if (v && typeof v === 'object' && '$ne' in v) return String(doc[k]) !== String(v.$ne);
    return String(doc[k]) === String(v);
  });
}

function clone(doc) {
  return doc === null ? null : JSON.parse(JSON.stringify(doc));
}

class MemoryRepo {
  constructor(name) {
    this.name = name;
    this.items = new Map();
  }

  async create(data) {
    const id = crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();
    const doc = { ...data, id, createdAt: now, updatedAt: now };
    this.items.set(id, doc);
    return clone(doc);
  }

  async find(filter = {}, { sort } = {}) {
    let out = [...this.items.values()].filter((d) => matches(d, filter));
    if (sort) {
      const [field, dir] = Object.entries(sort)[0];
      out.sort((a, b) => (String(a[field]) > String(b[field]) ? 1 : -1) * (dir === -1 ? -1 : 1));
    }
    return out.map(clone);
  }

  async findById(id) {
    return clone(this.items.get(String(id)) ?? null);
  }

  async findOne(filter = {}) {
    const found = [...this.items.values()].find((d) => matches(d, filter));
    return clone(found ?? null);
  }

  async updateById(id, patch) {
    const doc = this.items.get(String(id));
    if (!doc) return null;
    const next = { ...doc, ...patch, id: doc.id, updatedAt: new Date().toISOString() };
    this.items.set(String(id), next);
    return clone(next);
  }

  async deleteById(id) {
    const doc = this.items.get(String(id));
    if (!doc) return null;
    this.items.delete(String(id));
    return clone(doc);
  }

  async deleteMany(filter = {}) {
    let n = 0;
    for (const [id, doc] of [...this.items.entries()]) {
      if (matches(doc, filter)) {
        this.items.delete(id);
        n += 1;
      }
    }
    return n;
  }

  async count(filter = {}) {
    return (await this.find(filter)).length;
  }
}

export function createMemoryDb() {
  return {
    driver: 'memory',
    admins: new MemoryRepo('admins'),
    servers: new MemoryRepo('servers'),
    channels: new MemoryRepo('channels'),
    iptvUsers: new MemoryRepo('iptvUsers'),
    async connect() {},
    async disconnect() {},
    async isValidId(id) {
      return typeof id === 'string' && id.length > 0;
    },
  };
}
