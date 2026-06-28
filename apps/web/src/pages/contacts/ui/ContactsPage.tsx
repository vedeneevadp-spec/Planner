import { cx } from '@/shared/lib/classnames'
import { ChatIcon, GlobeIcon, MailIcon } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './ContactsPage.module.css'

const CONTACT_LINKS = [
  {
    description:
      'Если нужна помощь или хотите сообщить о проблеме, пишите на почту.',
    href: 'mailto:support@chaotika.ru',
    icon: <MailIcon size={20} strokeWidth={2} />,
    isExternal: false,
    label: 'support@chaotika.ru',
  },
  {
    description:
      'В канале можно получать свежие обновления и новости Chaotika.',
    href: 'https://t.me/plan_chaosa',
    icon: <ChatIcon size={20} strokeWidth={2} />,
    isExternal: true,
    label: '@plan_chaosa',
  },
  {
    description: 'Также доступен веб-интерфейс Chaotika.',
    href: 'https://chaotika.ru',
    icon: <GlobeIcon size={20} strokeWidth={2} />,
    isExternal: true,
    label: 'https://chaotika.ru',
  },
] as const

export function ContactsPage() {
  return (
    <section className={cx(pageStyles.page, styles.contactsPage)}>
      <PageHeader kicker="Раздел" title="Контакты" />

      <section className={styles.contactList} aria-label="Контакты">
        {CONTACT_LINKS.map((contact) => (
          <a
            key={contact.href}
            aria-label={`${contact.label}. ${contact.description}`}
            className={styles.contactLink}
            href={contact.href}
            rel={contact.isExternal ? 'noopener noreferrer' : undefined}
            target={contact.isExternal ? '_blank' : undefined}
          >
            <span className={styles.contactIcon} aria-hidden="true">
              {contact.icon}
            </span>
            <span className={styles.contactCopy}>
              <strong>{contact.label}</strong>
              <span>{contact.description}</span>
            </span>
          </a>
        ))}
      </section>
    </section>
  )
}
