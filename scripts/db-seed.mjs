import { scrypt } from 'node:crypto'
import { promisify } from 'node:util'

import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const scryptAsync = promisify(scrypt)
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const retries = 5
const retryDelayMs = 1000
const devPassword = 'chaotika-dev'

assertSafeSeedTarget(connectionString)

const users = [
  {
    appRole: 'owner',
    displayName: 'Tikondra',
    email: 'vedeneeva.d.p@gmail.com',
    id: '11111111-1111-4111-8111-111111111111',
  },
  {
    appRole: 'admin',
    displayName: 'Alex Mironov',
    email: 'alex.mironov@example.test',
    id: '11111111-1111-4111-8111-111111111112',
  },
  {
    appRole: 'user',
    displayName: 'Mila Vedeneeva',
    email: 'mila.vedeneeva@example.test',
    id: '11111111-1111-4111-8111-111111111113',
  },
  {
    appRole: 'user',
    displayName: 'Ivan Sokolov',
    email: 'ivan.sokolov@example.test',
    id: '11111111-1111-4111-8111-111111111114',
  },
  {
    appRole: 'user',
    displayName: 'Nora Kuznetsova',
    email: 'nora.kuznetsova@example.test',
    id: '11111111-1111-4111-8111-111111111115',
  },
  {
    appRole: 'guest',
    displayName: 'Guest Reviewer',
    email: 'guest.reviewer@example.test',
    id: '11111111-1111-4111-8111-111111111116',
  },
]

const userByName = Object.fromEntries(
  users.map((user) => [user.displayName, user]),
)
const owner = userByName.Tikondra
const alex = userByName['Alex Mironov']
const mila = userByName['Mila Vedeneeva']
const ivan = userByName['Ivan Sokolov']
const nora = userByName['Nora Kuznetsova']
const guest = userByName['Guest Reviewer']

const workspaces = [
  {
    description: 'Личное пространство с планами, покупками и рутинами.',
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'personal',
    name: 'Personal Workspace',
    ownerUserId: owner.id,
    slug: 'personal',
  },
  {
    description: 'Общие семейные дела, дом, школа и покупки.',
    id: '22222222-2222-4222-8222-222222222223',
    kind: 'shared',
    name: 'Family Operations',
    ownerUserId: owner.id,
    slug: 'family-operations',
  },
  {
    description: 'Рабочие задачи, релизы, исследования и операционка.',
    id: '22222222-2222-4222-8222-222222222224',
    kind: 'shared',
    name: 'Work Sprint',
    ownerUserId: owner.id,
    slug: 'work-sprint',
  },
  {
    description: 'Личное пространство Alex для проверки переключения.',
    id: '22222222-2222-4222-8222-222222222225',
    kind: 'personal',
    name: 'Alex Personal',
    ownerUserId: alex.id,
    slug: 'alex-personal',
  },
  {
    description: 'Школа, кружки, поездки и бытовые напоминания.',
    id: '22222222-2222-4222-8222-222222222226',
    kind: 'shared',
    name: 'Kids & School',
    ownerUserId: owner.id,
    slug: 'kids-school',
  },
]

const workspaceBySlug = Object.fromEntries(
  workspaces.map((workspace) => [workspace.slug, workspace]),
)
const personalWorkspace = workspaceBySlug.personal
const familyWorkspace = workspaceBySlug['family-operations']
const workWorkspace = workspaceBySlug['work-sprint']
const kidsWorkspace = workspaceBySlug['kids-school']

const memberships = [
  membership(1, personalWorkspace, owner, 'owner'),
  membership(2, familyWorkspace, owner, 'owner', 'group_admin'),
  membership(3, familyWorkspace, alex, 'admin', 'group_admin'),
  membership(4, familyWorkspace, mila, 'user', 'senior_member'),
  membership(5, familyWorkspace, ivan, 'user', 'member'),
  membership(6, workWorkspace, owner, 'owner', 'group_admin'),
  membership(7, workWorkspace, alex, 'admin', 'group_admin'),
  membership(8, workWorkspace, nora, 'user', 'senior_member'),
  membership(9, workWorkspace, guest, 'guest', 'member'),
  membership(10, workspaceBySlug['alex-personal'], alex, 'owner'),
  membership(11, kidsWorkspace, owner, 'owner', 'group_admin'),
  membership(12, kidsWorkspace, mila, 'admin', 'group_admin'),
  membership(13, kidsWorkspace, ivan, 'user', 'member'),
]

const projects = [
  project(1, personalWorkspace, 'Дом', 'home', '#2f6f62', 'home', 10),
  project(2, personalWorkspace, 'Работа', 'work', '#365f8c', 'briefcase', 20),
  project(3, personalWorkspace, 'Семья', 'family', '#b85c38', 'heart', 30),
  project(
    4,
    personalWorkspace,
    'Здоровье',
    'health',
    '#6c8f3d',
    'activity',
    40,
  ),
  project(5, personalWorkspace, 'Финансы', 'finance', '#8b6f2f', 'wallet', 50),
  project(
    6,
    personalWorkspace,
    'Личное',
    'personal-growth',
    '#7b5ea7',
    'sparkles',
    60,
  ),
  project(7, personalWorkspace, 'Поездки', 'travel', '#2f7f8f', 'map', 70),
  project(
    8,
    familyWorkspace,
    'Покупки',
    'family-shopping',
    '#2f6f62',
    'shopping-cart',
    10,
  ),
  project(
    9,
    familyWorkspace,
    'Дом и ремонт',
    'family-home',
    '#8b6f2f',
    'hammer',
    20,
  ),
  project(
    10,
    familyWorkspace,
    'Семейные планы',
    'family-plans',
    '#b85c38',
    'calendar-days',
    30,
  ),
  project(
    11,
    workWorkspace,
    'Продукт',
    'product',
    '#365f8c',
    'layout-dashboard',
    10,
  ),
  project(
    12,
    workWorkspace,
    'Операционка',
    'operations',
    '#6c8f3d',
    'list-checks',
    20,
  ),
  project(
    13,
    workWorkspace,
    'Исследования',
    'research',
    '#7b5ea7',
    'search',
    30,
  ),
  project(
    14,
    kidsWorkspace,
    'Школа',
    'school',
    '#365f8c',
    'graduation-cap',
    10,
  ),
  project(15, kidsWorkspace, 'Кружки', 'clubs', '#b85c38', 'music', 20),
]

const projectBySlug = Object.fromEntries(
  projects.map((projectItem) => [projectItem.slug, projectItem]),
)

const tasks = [
  task(1, personalWorkspace, projectBySlug.home, 'Разобрать входящие бумаги', {
    assignee: owner,
    icon: 'file-text',
    note: 'Квитанции, чеки, документы из сумки и прихожей.',
    plannedOffset: 0,
    start: '09:00',
    end: '09:35',
    urgency: 'urgent',
  }),
  task(2, personalWorkspace, projectBySlug.work, 'Подготовить план недели', {
    assignee: owner,
    icon: 'calendar-check',
    importance: 'important',
    plannedOffset: 0,
    start: '10:00',
    end: '10:45',
  }),
  task(3, personalWorkspace, projectBySlug.family, 'Позвонить маме', {
    assignee: owner,
    icon: 'phone',
    plannedOffset: 0,
    start: '19:30',
    end: '19:50',
  }),
  task(4, personalWorkspace, projectBySlug.health, 'Тренировка 35 минут', {
    assignee: owner,
    icon: 'dumbbell',
    plannedOffset: 1,
    resource: -3,
    start: '07:30',
    end: '08:05',
  }),
  task(
    5,
    personalWorkspace,
    projectBySlug.finance,
    'Сверить подписки и автоплатежи',
    {
      assignee: owner,
      dueOffset: 2,
      icon: 'credit-card',
      importance: 'important',
      plannedOffset: 1,
      start: '18:00',
      end: '18:40',
    },
  ),
  task(6, personalWorkspace, projectBySlug.home, 'Заказать фильтры для воды', {
    assignee: owner,
    dueOffset: 1,
    icon: 'droplets',
    plannedOffset: 1,
  }),
  task(
    7,
    personalWorkspace,
    projectBySlug['personal-growth'],
    '30 минут чтения без телефона',
    {
      assignee: owner,
      icon: 'book-open',
      plannedOffset: 2,
      resource: 2,
      start: '21:00',
      end: '21:30',
    },
  ),
  task(
    8,
    personalWorkspace,
    projectBySlug.travel,
    'Проверить даты поездки в Томск',
    {
      assignee: owner,
      dueOffset: 4,
      icon: 'train',
      plannedOffset: 2,
    },
  ),
  task(
    9,
    personalWorkspace,
    projectBySlug.work,
    'Разобрать backlog по мобильному релизу',
    {
      assignee: owner,
      icon: 'kanban',
      importance: 'important',
      plannedOffset: 3,
      start: '11:00',
      end: '12:15',
      status: 'in_progress',
    },
  ),
  task(
    10,
    personalWorkspace,
    projectBySlug.home,
    'Постирать спортивную форму',
    {
      assignee: owner,
      icon: 'washing-machine',
      plannedOffset: -1,
      status: 'done',
    },
  ),
  task(
    11,
    personalWorkspace,
    projectBySlug.family,
    'Собрать идеи для выходных',
    {
      assignee: owner,
      icon: 'trees',
      plannedOffset: 4,
    },
  ),
  task(
    12,
    personalWorkspace,
    projectBySlug.health,
    'Записаться к стоматологу',
    {
      assignee: owner,
      dueOffset: 7,
      icon: 'heart-pulse',
      urgency: 'urgent',
    },
  ),
  task(
    13,
    personalWorkspace,
    projectBySlug.finance,
    'Обновить бюджет на месяц',
    {
      assignee: owner,
      icon: 'chart-pie',
      importance: 'important',
      plannedOffset: 5,
    },
  ),
  task(
    14,
    personalWorkspace,
    projectBySlug['personal-growth'],
    'Навести порядок в заметках',
    {
      assignee: owner,
      icon: 'notebook-tabs',
      plannedOffset: 6,
    },
  ),
  task(
    15,
    personalWorkspace,
    projectBySlug.work,
    'Проверить ошибки из Sentry',
    {
      assignee: owner,
      icon: 'bug',
      importance: 'important',
      plannedOffset: 0,
      status: 'ready_for_review',
      urgency: 'urgent',
    },
  ),
  task(
    16,
    personalWorkspace,
    projectBySlug.home,
    'Помыть холодильник перед закупкой',
    {
      assignee: owner,
      icon: 'spray-can',
      plannedOffset: 3,
    },
  ),
  task(
    17,
    familyWorkspace,
    projectBySlug['family-shopping'],
    'Составить меню на неделю',
    {
      assignee: alex,
      icon: 'utensils',
      importance: 'important',
      plannedOffset: 0,
      start: '17:00',
      end: '17:30',
    },
  ),
  task(
    18,
    familyWorkspace,
    projectBySlug['family-home'],
    'Проверить замеры шкафа',
    {
      assignee: ivan,
      icon: 'ruler',
      plannedOffset: 1,
      status: 'in_progress',
    },
  ),
  task(
    19,
    familyWorkspace,
    projectBySlug['family-plans'],
    'Забронировать семейный ужин',
    {
      assignee: mila,
      dueOffset: 3,
      icon: 'calendar-heart',
      plannedOffset: 2,
    },
  ),
  task(
    20,
    familyWorkspace,
    projectBySlug['family-shopping'],
    'Сверить остатки бытовой химии',
    {
      assignee: owner,
      icon: 'package-check',
      plannedOffset: 0,
    },
  ),
  task(
    21,
    familyWorkspace,
    projectBySlug['family-home'],
    'Выбрать мастера для розеток',
    {
      assignee: alex,
      icon: 'plug',
      plannedOffset: 5,
    },
  ),
  task(
    22,
    workWorkspace,
    projectBySlug.product,
    'Проверить сценарий новой регистрации',
    {
      assignee: owner,
      icon: 'user-check',
      importance: 'important',
      plannedOffset: 0,
      start: '12:30',
      end: '13:15',
      status: 'in_progress',
    },
  ),
  task(
    23,
    workWorkspace,
    projectBySlug.operations,
    'Собрать список рисков перед релизом',
    {
      assignee: alex,
      icon: 'shield-alert',
      importance: 'important',
      plannedOffset: 1,
    },
  ),
  task(
    24,
    workWorkspace,
    projectBySlug.research,
    'Просмотреть заметки интервью',
    {
      assignee: nora,
      icon: 'messages-square',
      plannedOffset: 2,
      status: 'ready_for_review',
    },
  ),
  task(
    25,
    workWorkspace,
    projectBySlug.product,
    'Разбить крупную задачу на подзадачи',
    {
      assignee: owner,
      icon: 'list-tree',
      plannedOffset: 3,
    },
  ),
  task(26, kidsWorkspace, projectBySlug.school, 'Подписать дневник и форму', {
    assignee: mila,
    icon: 'pen-line',
    plannedOffset: 0,
  }),
  task(27, kidsWorkspace, projectBySlug.clubs, 'Оплатить музыку за месяц', {
    assignee: owner,
    dueOffset: 2,
    icon: 'music',
    importance: 'important',
    plannedOffset: 1,
  }),
  task(28, kidsWorkspace, projectBySlug.school, 'Купить папку для технологии', {
    assignee: ivan,
    icon: 'folder-plus',
    plannedOffset: 2,
  }),
  ...[
    ['Проверить аптечку дома', projectBySlug.health, 'first-aid-kit'],
    ['Разобрать зимние вещи', projectBySlug.home, 'archive'],
    [
      'Сделать резервную копию фото',
      projectBySlug['personal-growth'],
      'hard-drive',
    ],
    ['Выбрать книгу на месяц', projectBySlug['personal-growth'], 'book-marked'],
    ['Проверить страховку машины', projectBySlug.finance, 'car'],
    ['Собрать список подарков', projectBySlug.family, 'gift'],
    ['Почистить список подписок', projectBySlug.finance, 'receipt-text'],
    ['Запланировать выходной без экрана', projectBySlug.health, 'sun'],
    ['Обновить домашний чеклист уборки', projectBySlug.home, 'list-checks'],
    ['Проверить документы для поездки', projectBySlug.travel, 'passport'],
    ['Подготовить вопросы к синку', projectBySlug.work, 'message-square'],
    ['Пересобрать список привычек', projectBySlug['personal-growth'], 'repeat'],
  ].map(([title, projectItem, icon], index) =>
    task(29 + index, personalWorkspace, projectItem, title, {
      assignee: owner,
      dueOffset: 3 + (index % 6),
      icon,
      importance: index % 3 === 0 ? 'important' : undefined,
      plannedOffset: index % 8,
      resource: index % 2 === 0 ? -2 : 1,
      status: index % 5 === 0 ? 'in_progress' : 'todo',
    }),
  ),
  ...[
    [
      'Согласовать список гостей',
      familyWorkspace,
      projectBySlug['family-plans'],
      mila,
      'users',
    ],
    [
      'Проверить доставку продуктов',
      familyWorkspace,
      projectBySlug['family-shopping'],
      alex,
      'truck',
    ],
    [
      'Сфотографировать проблемные места ремонта',
      familyWorkspace,
      projectBySlug['family-home'],
      ivan,
      'camera',
    ],
    [
      'Подготовить демо для команды',
      workWorkspace,
      projectBySlug.product,
      owner,
      'presentation',
    ],
    [
      'Сверить метрики после релиза',
      workWorkspace,
      projectBySlug.operations,
      nora,
      'chart-no-axes-combined',
    ],
    [
      'Описать результаты исследования',
      workWorkspace,
      projectBySlug.research,
      alex,
      'file-search',
    ],
    [
      'Собрать форму на физкультуру',
      kidsWorkspace,
      projectBySlug.school,
      mila,
      'shirt',
    ],
    [
      'Уточнить расписание кружков',
      kidsWorkspace,
      projectBySlug.clubs,
      owner,
      'clock',
    ],
  ].map(([title, workspace, projectItem, assignee, icon], index) =>
    task(41 + index, workspace, projectItem, title, {
      assignee,
      icon,
      importance: index % 2 === 0 ? 'important' : undefined,
      plannedOffset: 1 + (index % 5),
      status: index % 4 === 0 ? 'ready_for_review' : 'todo',
    }),
  ),
]

const shoppingItems = [
  'Молоко 2 литра',
  'Хлеб цельнозерновой',
  'Яйца 20 штук',
  'Куриное филе',
  'Творог 5%',
  'Овсянка',
  'Гречка',
  'Рис жасмин',
  'Помидоры',
  'Огурцы',
  'Авокадо',
  'Яблоки',
  'Бананы',
  'Лимоны',
  'Сыр для завтраков',
  'Йогурт без сахара',
  'Кофе в зернах',
  'Чай травяной',
  'Вода газированная',
  'Пакеты для мусора',
  'Средство для посуды',
  'Таблетки для посудомойки',
  'Бумажные полотенца',
  'Зубная паста',
  'Шампунь детский',
  'Корм для кота',
  'Батарейки AA',
  'Лампочка E27 теплая',
  'Салфетки влажные',
  'Пластырь',
  'Магний',
  'Контейнеры для еды',
  'Фольга',
  'Пакеты для заморозки',
  'Цветы на стол',
].map((text, index) =>
  inboxItem(index + 1, personalWorkspace, owner, text, 'shopping', {
    dueOffset: index % 5,
    priority: index % 7 === 0 ? 'high' : index % 3 === 0 ? 'medium' : 'low',
    source: index % 4 === 0 ? 'quick_add' : 'manual',
  }),
)

const inboxItems = [
  ...shoppingItems,
  inboxItem(
    101,
    personalWorkspace,
    owner,
    'Идея: сделать быстрый режим планирования утра',
    'idea',
    {
      priority: 'medium',
    },
  ),
  inboxItem(
    102,
    personalWorkspace,
    owner,
    'Заметка: проверить оплату парковки',
    'note',
    {
      dueOffset: 1,
    },
  ),
  inboxItem(
    103,
    personalWorkspace,
    owner,
    'Записать голосом список вопросов врачу',
    'task',
    {
      priority: 'high',
      source: 'voice',
    },
  ),
  inboxItem(
    104,
    familyWorkspace,
    alex,
    'Купить подарок на день рождения',
    'shopping',
    {
      priority: 'high',
    },
  ),
  inboxItem(
    105,
    familyWorkspace,
    mila,
    'Проверить школьный чат перед понедельником',
    'task',
    {
      dueOffset: 2,
    },
  ),
  inboxItem(106, workWorkspace, nora, 'Идея для onboarding checklist', 'idea', {
    priority: 'medium',
  }),
]

const taskTemplates = [
  template(1, personalWorkspace, projectBySlug.work, 'Еженедельный обзор', {
    icon: 'calendar-search',
    importance: 'important',
    note: 'Проверить цели, встречи, дедлайны и незакрытые хвосты.',
    plannedStartTime: '10:00',
    plannedEndTime: '10:45',
  }),
  template(2, personalWorkspace, projectBySlug.health, 'Тренировка дома', {
    icon: 'dumbbell',
    note: 'Разминка, основная часть, растяжка.',
    plannedStartTime: '07:30',
    plannedEndTime: '08:05',
  }),
  template(3, personalWorkspace, projectBySlug.finance, 'Финансовый чек', {
    icon: 'wallet-cards',
    importance: 'important',
    note: 'Проверить счета, подписки, крупные траты и бюджет недели.',
  }),
  template(
    4,
    familyWorkspace,
    projectBySlug['family-shopping'],
    'Большая закупка',
    {
      icon: 'shopping-cart',
      note: 'Сверить остатки, меню и бытовую химию.',
    },
  ),
  template(5, workWorkspace, projectBySlug.operations, 'Релизный контроль', {
    icon: 'rocket',
    importance: 'important',
    note: 'Проверить риски, миграции, мониторинг и коммуникацию.',
    plannedStartTime: '16:00',
    plannedEndTime: '17:00',
  }),
]

const timeBlocks = tasks
  .filter((taskItem) => taskItem.plannedStartTime && taskItem.plannedEndTime)
  .map((taskItem, index) => ({
    createdBy: taskItem.createdBy,
    endsAt: timestamp(taskItem.plannedOn, taskItem.plannedEndTime),
    id: seedId('66666666-6666-4666-8666', index + 1),
    startsAt: timestamp(taskItem.plannedOn, taskItem.plannedStartTime),
    taskId: taskItem.id,
    updatedBy: taskItem.updatedBy,
    workspaceId: taskItem.workspaceId,
  }))

async function main() {
  const passwordHashes = await Promise.all(
    users.map(async (user) => ({
      email: user.email,
      passwordHash: await hashPassword(devPassword),
      userId: user.id,
    })),
  )

  await runSeed(async (client) => {
    await client.query('begin')

    try {
      await seedUsers(client)
      await seedAuthCredentials(client, passwordHashes)
      await seedWorkspaces(client)
      await seedMemberships(client)
      await seedProjects(client)
      await seedTasks(client)
      await seedTaskTimeBlocks(client)
      await seedInboxItems(client)
      await seedTaskTemplates(client)

      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })

  console.log('Seed completed.')
  console.log(`Users: ${users.length}`)
  console.log(`Workspaces: ${workspaces.length}`)
  console.log(`Spheres: ${projects.length}`)
  console.log(`Tasks: ${tasks.length}`)
  console.log(`Shopping and inbox items: ${inboxItems.length}`)
  console.log(`Task templates: ${taskTemplates.length}`)
  console.log(`Default User ID: ${owner.id}`)
  console.log(`Default Workspace ID: ${personalWorkspace.id}`)
  console.log(`Optional auth password for seeded users: ${devPassword}`)
}

async function seedUsers(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          email text,
          "displayName" text,
          "appRole" text
        )
      )
      insert into app.users (
        id,
        app_role,
        email,
        display_name,
        timezone,
        locale,
        deleted_at
      )
      select
        id,
        "appRole"::app.app_role,
        email,
        "displayName",
        'Asia/Novosibirsk',
        'ru-RU',
        null
      from payload
      on conflict (id) do update
      set
        app_role = excluded.app_role,
        email = excluded.email,
        display_name = excluded.display_name,
        timezone = excluded.timezone,
        locale = excluded.locale,
        deleted_at = null
    `,
    [JSON.stringify(users)],
  )
}

async function seedAuthCredentials(client, passwordHashes) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          "userId" uuid,
          email text,
          "passwordHash" text
        )
      )
      insert into app.auth_credentials (
        user_id,
        email,
        password_hash,
        deleted_at
      )
      select
        "userId",
        email,
        "passwordHash",
        null
      from payload
      on conflict (user_id) do update
      set
        email = excluded.email,
        password_hash = excluded.password_hash,
        password_updated_at = now(),
        deleted_at = null
    `,
    [JSON.stringify(passwordHashes)],
  )
}

async function seedWorkspaces(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "ownerUserId" uuid,
          name text,
          slug text,
          description text,
          kind text
        )
      )
      insert into app.workspaces (
        id,
        owner_user_id,
        name,
        slug,
        description,
        kind,
        deleted_at
      )
      select
        id,
        "ownerUserId",
        name,
        slug,
        description,
        kind::app.workspace_kind,
        null
      from payload
      on conflict (id) do update
      set
        owner_user_id = excluded.owner_user_id,
        name = excluded.name,
        slug = excluded.slug,
        description = excluded.description,
        kind = excluded.kind,
        deleted_at = null
    `,
    [JSON.stringify(workspaces)],
  )
}

async function seedMemberships(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          "userId" uuid,
          role text,
          "groupRole" text
        )
      )
      insert into app.workspace_members (
        id,
        workspace_id,
        user_id,
        role,
        group_role,
        deleted_at
      )
      select
        id,
        "workspaceId",
        "userId",
        role::app.workspace_role,
        nullif("groupRole", '')::app.workspace_group_role,
        null
      from payload
      on conflict (workspace_id, user_id) do update
      set
        role = excluded.role,
        group_role = excluded.group_role,
        deleted_at = null
    `,
    [JSON.stringify(memberships)],
  )
}

async function seedProjects(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          title text,
          slug text,
          description text,
          color text,
          icon text,
          position integer,
          "createdBy" uuid,
          "updatedBy" uuid,
          metadata jsonb
        )
      )
      insert into app.projects (
        id,
        workspace_id,
        title,
        slug,
        description,
        color,
        icon,
        status,
        position,
        metadata,
        created_by,
        updated_by,
        deleted_at
      )
      select
        id,
        "workspaceId",
        title,
        slug,
        description,
        color,
        icon,
        'active'::app.project_status,
        position,
        metadata,
        "createdBy",
        "updatedBy",
        null
      from payload
      on conflict (id) do update
      set
        title = excluded.title,
        slug = excluded.slug,
        description = excluded.description,
        color = excluded.color,
        icon = excluded.icon,
        status = excluded.status,
        position = excluded.position,
        metadata = excluded.metadata,
        updated_by = excluded.updated_by,
        deleted_at = null
    `,
    [JSON.stringify(projects)],
  )
}

async function seedTasks(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          "projectId" uuid,
          "sphereId" uuid,
          "assigneeUserId" uuid,
          title text,
          description text,
          status text,
          priority smallint,
          "plannedOn" date,
          "dueOn" date,
          "completedAt" timestamptz,
          resource smallint,
          metadata jsonb,
          "createdBy" uuid,
          "updatedBy" uuid
        )
      )
      insert into app.tasks (
        id,
        workspace_id,
        project_id,
        sphere_id,
        assignee_user_id,
        title,
        description,
        status,
        priority,
        planned_on,
        due_on,
        completed_at,
        resource,
        metadata,
        created_by,
        updated_by,
        sort_key,
        deleted_at
      )
      select
        id,
        "workspaceId",
        "projectId",
        "sphereId",
        "assigneeUserId",
        title,
        description,
        status::app.task_status,
        priority,
        "plannedOn",
        "dueOn",
        "completedAt",
        resource,
        metadata,
        "createdBy",
        "updatedBy",
        '',
        null
      from payload
      on conflict (id) do update
      set
        workspace_id = excluded.workspace_id,
        project_id = excluded.project_id,
        sphere_id = excluded.sphere_id,
        assignee_user_id = excluded.assignee_user_id,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        planned_on = excluded.planned_on,
        due_on = excluded.due_on,
        completed_at = excluded.completed_at,
        resource = excluded.resource,
        metadata = excluded.metadata,
        updated_by = excluded.updated_by,
        deleted_at = null
    `,
    [JSON.stringify(tasks)],
  )
}

async function seedTaskTimeBlocks(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          "taskId" uuid,
          "startsAt" timestamptz,
          "endsAt" timestamptz,
          "createdBy" uuid,
          "updatedBy" uuid
        )
      )
      insert into app.task_time_blocks (
        id,
        workspace_id,
        task_id,
        starts_at,
        ends_at,
        timezone,
        source,
        position,
        metadata,
        created_by,
        updated_by,
        deleted_at
      )
      select
        id,
        "workspaceId",
        "taskId",
        "startsAt",
        "endsAt",
        'Asia/Novosibirsk',
        'manual',
        0,
        '{}'::jsonb,
        "createdBy",
        "updatedBy",
        null
      from payload
      on conflict (id) do update
      set
        workspace_id = excluded.workspace_id,
        task_id = excluded.task_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        timezone = excluded.timezone,
        updated_by = excluded.updated_by,
        deleted_at = null
    `,
    [JSON.stringify(timeBlocks)],
  )
}

async function seedInboxItems(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          "userId" uuid,
          text text,
          source text,
          status text,
          kind text,
          "sphereId" uuid,
          priority text,
          "dueOn" date,
          "createdBy" uuid,
          "updatedBy" uuid
        )
      )
      insert into app.chaos_inbox_items (
        id,
        workspace_id,
        user_id,
        text,
        source,
        status,
        kind,
        sphere_id,
        priority,
        due_on,
        created_by,
        updated_by,
        deleted_at
      )
      select
        id,
        "workspaceId",
        "userId",
        text,
        source,
        status,
        kind,
        "sphereId",
        priority,
        "dueOn",
        "createdBy",
        "updatedBy",
        null
      from payload
      on conflict (id) do update
      set
        workspace_id = excluded.workspace_id,
        user_id = excluded.user_id,
        text = excluded.text,
        source = excluded.source,
        status = excluded.status,
        kind = excluded.kind,
        sphere_id = excluded.sphere_id,
        priority = excluded.priority,
        due_on = excluded.due_on,
        updated_by = excluded.updated_by,
        deleted_at = null
    `,
    [JSON.stringify(inboxItems)],
  )
}

async function seedTaskTemplates(client) {
  await client.query(
    `
      with payload as (
        select *
        from jsonb_to_recordset($1::jsonb) as item(
          id uuid,
          "workspaceId" uuid,
          "projectId" uuid,
          title text,
          description text,
          "plannedOn" date,
          "plannedStartTime" time,
          "plannedEndTime" time,
          "dueOn" date,
          metadata jsonb,
          "createdBy" uuid,
          "updatedBy" uuid
        )
      )
      insert into app.task_templates (
        id,
        workspace_id,
        project_id,
        title,
        description,
        planned_on,
        planned_start_time,
        planned_end_time,
        due_on,
        metadata,
        created_by,
        updated_by,
        deleted_at
      )
      select
        id,
        "workspaceId",
        "projectId",
        title,
        description,
        "plannedOn",
        "plannedStartTime",
        "plannedEndTime",
        "dueOn",
        metadata,
        "createdBy",
        "updatedBy",
        null
      from payload
      on conflict (id) do update
      set
        workspace_id = excluded.workspace_id,
        project_id = excluded.project_id,
        title = excluded.title,
        description = excluded.description,
        planned_on = excluded.planned_on,
        planned_start_time = excluded.planned_start_time,
        planned_end_time = excluded.planned_end_time,
        due_on = excluded.due_on,
        metadata = excluded.metadata,
        updated_by = excluded.updated_by,
        deleted_at = null
    `,
    [JSON.stringify(taskTemplates)],
  )
}

async function runSeed(callback) {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = createClient()

    try {
      await client.connect()
      await preparePgAdminConnection(client)
      await callback(client)
      return
    } catch (error) {
      lastError = error

      if (!isTransientConnectionError(error) || attempt === retries) {
        throw error
      }

      console.log(
        `Transient database error during seed. Retry ${attempt}/${retries} in ${retryDelayMs}ms.`,
      )
      await wait(retryDelayMs)
    } finally {
      await closePgClient(client)
    }
  }

  throw lastError
}

function createClient() {
  const client = new Client(createPgConnectionConfig(connectionString))

  client.on('error', (error) => {
    if (isTransientConnectionError(error)) {
      return
    }

    console.error(
      `Database client error (${error.code ?? 'unknown'}): ${error.message}`,
    )
  })

  return client
}

function membership(index, workspace, user, role, groupRole = '') {
  return {
    groupRole,
    id: seedId('33333333-3333-4333-8333', index),
    role,
    userId: user.id,
    workspaceId: workspace.id,
  }
}

function project(index, workspace, title, slug, color, icon, position) {
  return {
    color,
    createdBy: workspace.ownerUserId,
    description: `${title}: тестовая сфера для проверки планирования и фильтров.`,
    icon,
    id: seedId('44444444-4444-4444-8444', index),
    metadata: {
      seeded: true,
    },
    position,
    slug,
    title,
    updatedBy: workspace.ownerUserId,
    workspaceId: workspace.id,
  }
}

function task(index, workspace, projectItem, title, options = {}) {
  const plannedOn =
    options.plannedOffset === undefined
      ? null
      : dateOffset(options.plannedOffset)
  const dueOn =
    options.dueOffset === undefined ? plannedOn : dateOffset(options.dueOffset)
  const status = options.status ?? 'todo'

  return {
    assigneeUserId: options.assignee?.id ?? workspace.ownerUserId,
    completedAt:
      status === 'done'
        ? timestamp(plannedOn ?? dateOffset(-1), '18:00')
        : null,
    createdBy: workspace.ownerUserId,
    description: options.note ?? '',
    dueOn,
    id: seedId('55555555-5555-4555-8555', index),
    metadata: taskMetadata(options),
    plannedEndTime: options.end ?? null,
    plannedOn,
    plannedStartTime: options.start ?? null,
    priority: options.priority ?? 2,
    projectId: projectItem.id,
    resource: options.resource ?? null,
    sphereId: projectItem.id,
    status,
    title,
    updatedBy: workspace.ownerUserId,
    workspaceId: workspace.id,
  }
}

function inboxItem(index, workspace, user, text, kind, options = {}) {
  return {
    createdBy: user.id,
    dueOn:
      options.dueOffset === undefined ? null : dateOffset(options.dueOffset),
    id: seedId('77777777-7777-4777-8777', index),
    kind,
    priority: options.priority ?? null,
    source: options.source ?? 'manual',
    sphereId: null,
    status: options.status ?? 'new',
    text,
    updatedBy: user.id,
    userId: user.id,
    workspaceId: workspace.id,
  }
}

function template(index, workspace, projectItem, title, options = {}) {
  return {
    createdBy: workspace.ownerUserId,
    description: options.note ?? '',
    dueOn: null,
    id: seedId('88888888-8888-4888-8888', index),
    metadata: taskMetadata(options),
    plannedEndTime: options.plannedEndTime ?? null,
    plannedOn: null,
    plannedStartTime: options.plannedStartTime ?? null,
    projectId: projectItem.id,
    title,
    updatedBy: workspace.ownerUserId,
    workspaceId: workspace.id,
  }
}

function taskMetadata(options) {
  const metadata = {
    seeded: true,
  }

  if (options.icon) {
    metadata.taskIcon = options.icon
  }

  if (options.importance) {
    metadata.taskImportance = options.importance
  }

  if (options.urgency) {
    metadata.taskUrgency = options.urgency
  }

  if (options.requiresConfirmation) {
    metadata.taskRequiresConfirmation = true
  }

  if (options.remindBeforeStart) {
    metadata.taskRemindBeforeStart = true
  }

  return metadata
}

function seedId(prefix, index) {
  return `${prefix}-${String(index).padStart(12, '0')}`
}

function dateOffset(offsetDays) {
  const date = new Date()

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)

  return date.toISOString().slice(0, 10)
}

function timestamp(date, time) {
  return `${date}T${time}:00+07:00`
}

async function hashPassword(password) {
  const salt = 'chaotika-dev-seed'
  const derivedKey = await scryptAsync(password, salt, 64, {
    N: 16_384,
    maxmem: 64 * 1024 * 1024,
    p: 1,
    r: 8,
  })

  return [
    'scrypt',
    'N=16384,r=8,p=1',
    salt,
    derivedKey.toString('base64url'),
  ].join('$')
}

function assertSafeSeedTarget(value) {
  if (process.env.DB_SEED_ALLOW_NON_LOCAL === '1') {
    return
  }

  const url = new URL(value)
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])

  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to seed non-local database host "${url.hostname}". Set DB_SEED_ALLOW_NON_LOCAL=1 only if this is intentional.`,
    )
  }
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function isTransientConnectionError(error) {
  if (typeof error?.code === 'string') {
    return ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error.code)
  }

  return (
    error instanceof Error &&
    (error.message.includes('Client has encountered a connection error') ||
      error.message.includes('Connection terminated') ||
      error.message.includes('Query read timeout') ||
      error.message.includes('timeout'))
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
