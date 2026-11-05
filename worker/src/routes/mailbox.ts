import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { parseDomains, clamp } from '../lib/util';
import { randomHex } from '../lib/crypto';

const mailbox = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

interface AddressRow {
  id: number;
  user_id: number;
  address: string;
  domain: string;
  display_name: string | null;
  enabled: number;
  created_at: number;
}

/**
 * 地址列表。
 *
 * 默认管理员看全站（管理页要用），普通用户看自己的。
 * `scope=mine` → **任何人（含管理员）都只看自己的**，
 * 写信页的「发件人」下拉就用这个，避免选到别人的地址。
 */
mailbox.get('/', authRequired, async (c) => {
  const user = c.get('user');
  const mine = c.req.query('scope') === 'mine';

  if (mine || user.role !== 'admin') {
    const rows = await qAll<AddressRow>(
      c.env.DB,
      'SELECT * FROM mail_address WHERE user_id = ? ORDER BY id DESC LIMIT 500',
      user.id,
    );
    return c.json(ok(rows));
  }

  const rows = await qAll<AddressRow & { email?: string }>(
    c.env.DB,
    'SELECT a.*, u.email AS owner FROM mail_address a LEFT JOIN user u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 500',
  );
  return c.json(ok(rows));
});

mailbox.post('/', authRequired, async (c) => {
  const user = c.get('user');
  const { local, domain } = (await c.req.json().catch(() => ({}))) as { local?: string; domain?: string };
  const domains = parseDomains(c.env);
  if (!domains.length) throw new HttpError('未配置 MAIL_DOMAINS');
  const dom = domain && domains.includes(domain) ? domain : domains[0];
  const name = (local ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!name) throw new HttpError('地址前缀不合法');
  const address = `${name}@${dom}`;
  const exist = await qOne(c.env.DB, 'SELECT id FROM mail_address WHERE address = ?', address);
  if (exist) throw new HttpError('地址已存在');
  await exec(
    c.env.DB,
    'INSERT INTO mail_address (user_id, address, domain, enabled, created_at) VALUES (?,?,?,1,?)',
    user.id,
    address,
    dom,
    Date.now(),
  );
  return c.json(ok({ address }));
});

/** 批量分发账号地址：前缀 + 序号 / 随机串 */
mailbox.post('/batch', authRequired, async (c) => {
  const user = c.get('user');
  const { prefix, count, domain } = (await c.req.json().catch(() => ({}))) as {
    prefix?: string;
    count?: number;
    domain?: string;
  };
  const domains = parseDomains(c.env);
  const dom = domain && domains.includes(domain) ? domain : domains[0];
  if (!dom) throw new HttpError('未配置 MAIL_DOMAINS');
  const n = clamp(Number(count ?? 5), 1, 100);
  const base = (prefix ?? 'box').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'box';
  const created: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const address = `${base}-${randomHex(3)}@${dom}`;
    await exec(
      c.env.DB,
      'INSERT OR IGNORE INTO mail_address (user_id, address, domain, enabled, created_at) VALUES (?,?,?,1,?)',
      user.id,
      address,
      dom,
      now,
    );
    created.push(address);
  }
  return c.json(ok({ created }));
});

/**
 * 改邮箱：开关 / 显示名称 / 转移给另一位用户。
 * 显示名称只影响侧栏列表里显示的名字，不改地址本身。
 * 转移仅管理员可用：只改地址归属，新邮件归新用户；旧邮件仍留在原用户的收件箱里。
 */
mailbox.put('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const { enabled, display_name, owner_id } = (await c.req.json().catch(() => ({}))) as {
    enabled?: number;
    display_name?: string | null;
    owner_id?: number;
  };
  const row = await qOne<AddressRow>(c.env.DB, 'SELECT * FROM mail_address WHERE id = ?', id);
  if (!row) throw new HttpError('地址不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权操作', 403);
  if (enabled !== undefined) {
    await exec(c.env.DB, 'UPDATE mail_address SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
  }
  if (display_name !== undefined) {
    const name = String(display_name ?? '').trim().slice(0, 50);
    await exec(c.env.DB, 'UPDATE mail_address SET display_name = ? WHERE id = ?', name || null, id);
  }
  if (owner_id !== undefined) {
    if (user.role !== 'admin') throw new HttpError('只有管理员可以转移邮箱', 403);
    const target = await qOne<{ id: number }>(c.env.DB, 'SELECT id FROM user WHERE id = ?', Number(owner_id));
    if (!target) throw new HttpError('目标用户不存在', 404);
    await exec(c.env.DB, 'UPDATE mail_address SET user_id = ? WHERE id = ?', Number(owner_id), id);
  }
  return c.json(ok({ updated: true }));
});

mailbox.delete('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await qOne<AddressRow>(c.env.DB, 'SELECT * FROM mail_address WHERE id = ?', id);
  if (!row) throw new HttpError('地址不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权操作', 403);
  await exec(c.env.DB, 'DELETE FROM mail_address WHERE id = ?', id);
  return c.json(ok({ deleted: true }));
});

export default mailbox;
