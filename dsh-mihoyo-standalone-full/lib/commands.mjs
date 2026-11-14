/**
 * 命令索引：把 bot.js 里散在 if 链中的命令词收成一张表。
 *
 * 这一份是**纯数据**，不改路由行为。用途有三个：
 *   1. 想知道机器人支持什么，看这里，不用翻 500 行 if
 *   2. 日志里能记下“这条消息命中了哪个命令组”，排查方便
 *   3. 以后真要把 if 链换成表驱动，从这份表开始迁
 *
 * 加新命令时**两处都要改**：这里的词表，和 bot.js 里的实现。
 * 两边不一致时以 bot.js 为准——这份表是从代码里誊出来的。
 */

export const COMMAND_GROUPS = [
  {
    id: 'version',
    words: ['版本', '喵喵版本', '插件版本'],
    desc: '看服务版本',
  },
  {
    id: 'bind',
    words: ['uid', '绑定', '绑定<UID>', 'uid<UID>'],
    desc: '绑定或切换 UID',
  },
  {
    id: 'unbind',
    words: ['解绑'],
    desc: '删掉自己的绑定',
  },
  {
    id: 'qrcode',
    words: ['扫码登录'],
    desc: '扫码登录米游社',
  },
  {
    id: 'helpimg',
    words: ['帮助图', '菜单图', '面板帮助', '帮助面板'],
    desc: '帮助文字或帮助图',
  },
  {
    id: 'panel',
    words: ['面板', '面板图', '出图', '角色图', '角色', '角色卡片'],
    desc: '角色列表图',
  },
  {
    id: 'char',
    words: ['查询', '查询<名字>', '角色<名字>', '面板<名字>'],
    desc: '单个角色大卡',
  },
  {
    id: 'refresh',
    words: ['更新面板', '刷新面板'],
    desc: '绕过缓存重拉 Enka（有冷却）',
  },
  {
    id: 'gamepanel',
    words: ['星铁面板', '星铁', '绝区零面板', '绝区零'],
    desc: '指定游戏的面板',
  },
  {
    id: 'gear',
    words: ['圣遗物列表', '武器列表', '圣遗物', '武器'],
    desc: '圣遗物 / 武器清单',
  },
  {
    id: 'ck',
    words: ['我的ck', '查看ck', '查看cookie', '删除ck', '删除cookie'],
    desc: '查看或删除自己的 CK',
  },
  {
    id: 'unsupported',
    words: [
      '深渊',
      '深渊12层',
      '本期深渊',
      '幽境',
      '剧诗',
      '幻想真境剧诗',
      '签到',
      '体力',
      '原石',
      '抽卡记录',
      '导入抽卡记录',
      '兑换码',
      '活动',
      '日历',
    ],
    desc: '需要米游社私有接口，当前明确回“做不了”',
  },
]

/** 词 -> 命令组，懒建一次 */
let index = null

function ensureIndex() {
  if (index) return index
  index = new Map()
  for (const g of COMMAND_GROUPS) {
    for (const w of g.words) {
      // 带 <...> 的是说明性写法，不当真词
      if (w.includes('<')) continue
      index.set(w, g)
    }
  }
  return index
}

/**
 * 查一个命令词属于哪组。
 * 先精确匹配，再前缀匹配（绑定123456789 这种）。
 */
export function lookupCommand(word) {
  const idx = ensureIndex()
  const w = String(word || '').trim()
  if (!w) return null
  const exact = idx.get(w)
  if (exact) return exact
  for (const [k, g] of idx) {
    if (w.startsWith(k) && w.length > k.length) return g
  }
  return null
}

/** 给看板 / 调试接口用的纯数据视图 */
export function commandList() {
  return COMMAND_GROUPS.map((g) => ({
    id: g.id,
    words: g.words,
    desc: g.desc,
  }))
}
