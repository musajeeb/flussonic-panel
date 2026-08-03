import mongoose from 'mongoose';
import { env } from '../config/env.js';

const { Schema } = mongoose;

const opts = { timestamps: true, versionKey: false };

const adminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: 'Administrator' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'admin'], default: 'admin' },
  },
  opts
);

const serverSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'General', trim: true },
    protocol: { type: String, enum: ['http', 'https'], default: 'http' },
    host: { type: String, required: true, trim: true },
    port: { type: Number, default: 8080 },
    apiUser: { type: String, required: true },
    apiPasswordEnc: { type: String, required: true },
    playbackDomain: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['online', 'offline', 'unknown'], default: 'unknown' },
    statusPath: { type: String, default: '' },
    failCount: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    stats: {
      cpuPercent: { type: Number, default: null },
      memoryPercent: { type: Number, default: null },
      memoryTotalBytes: { type: Number, default: null },
      memoryUsedBytes: { type: Number, default: null },
      diskPercent: { type: Number, default: null },
      diskTotalBytes: { type: Number, default: null },
      diskUsedBytes: { type: Number, default: null },
      inputBitrateBps: { type: Number, default: null },
      outputBitrateBps: { type: Number, default: null },
      streamsTotal: { type: Number, default: null },
      streamsAlive: { type: Number, default: null },
      clients: { type: Number, default: null },
      uptimeSec: { type: Number, default: null },
      version: { type: String, default: '' },
      notes: { type: String, default: '' },
      outputEstimated: { type: Boolean, default: false },
      topStreams: { type: Array, default: [] },
      cpuSample: { type: Object, default: null },
      checkedAt: { type: Date, default: null },
    },
  },
  opts
);

const channelSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, default: '' },
    serverId: { type: String, required: true, index: true },
    sourceUrl: { type: String, default: '', trim: true },
    category: { type: String, default: 'General', trim: true },
    logo: { type: String, default: '' },
    epgId: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    origin: { type: String, enum: ['panel', 'imported'], default: 'panel' },
    syncState: { type: String, enum: ['pending', 'synced', 'error'], default: 'pending' },
    syncError: { type: String, default: '' },
    lastSyncedAt: { type: Date, default: null },
  },
  opts
);

const iptvUserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    token: { type: String, required: true, unique: true, index: true },
    note: { type: String, default: '' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    maxConnections: { type: Number, default: 1 },
    expiresAt: { type: Date, default: null },
    allowedCategories: { type: [String], default: [] },
    allowedServerIds: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: null },
    lastIp: { type: String, default: '' },
  },
  opts
);

function normalize(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  delete obj._id;
  return obj;
}

class MongoRepo {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return normalize(await this.model.create(data));
  }

  async find(filter = {}, { sort } = {}) {
    const q = this.model.find(filter);
    if (sort) q.sort(sort);
    return (await q.lean()).map(normalize);
  }

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalize(await this.model.findById(id).lean());
  }

  async findOne(filter = {}) {
    return normalize(await this.model.findOne(filter).lean());
  }

  async updateById(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalize(await this.model.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).lean());
  }

  async deleteById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalize(await this.model.findByIdAndDelete(id).lean());
  }

  async deleteMany(filter = {}) {
    const res = await this.model.deleteMany(filter);
    return res.deletedCount ?? 0;
  }

  async count(filter = {}) {
    return this.model.countDocuments(filter);
  }
}

export function createMongoDb() {
  const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
  const Server = mongoose.models.Server || mongoose.model('Server', serverSchema);
  const Channel = mongoose.models.Channel || mongoose.model('Channel', channelSchema);
  const IptvUser = mongoose.models.IptvUser || mongoose.model('IptvUser', iptvUserSchema);

  return {
    driver: 'mongo',
    models: { Admin, Server, Channel, IptvUser },
    admins: new MongoRepo(Admin),
    servers: new MongoRepo(Server),
    channels: new MongoRepo(Channel),
    iptvUsers: new MongoRepo(IptvUser),
    async connect() {
      mongoose.set('strictQuery', true);
      await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    },
    async disconnect() {
      await mongoose.disconnect();
    },
    async isValidId(id) {
      return mongoose.isValidObjectId(id);
    },
  };
}
