import {
  FileCheck2, HardHat, Receipt, Scale, Ruler, BarChart3, FolderOpen,
  Briefcase, Building2, Users, ShieldCheck, Zap, BookOpen, Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface Category {
  value: string
  label: string
  description: string
  icon: LucideIcon
  iconName: string
  colorName: string
  textColor: string
  bgColor: string
  borderColor: string
  activeBorder: string
  activeBg: string
  activeText: string
  dbId?: string
  isCustom?: boolean
}

// Serializable subset — safe to pass from Server → Client Components (no icon function).
// Use buildCategory() on the client to reconstruct the full Category with icon.
export type CategoryInit = Omit<Category, 'icon'>

export interface DbCategory {
  id: string
  value: string
  label: string
  description: string
  icon_name: string
  color_name: string
}

export const ICON_OPTIONS: Record<string, { icon: LucideIcon; label: string }> = {
  'folder':      { icon: FolderOpen,  label: 'Folder'    },
  'file-check':  { icon: FileCheck2,  label: 'File'      },
  'bar-chart':   { icon: BarChart3,   label: 'Chart'     },
  'briefcase':   { icon: Briefcase,   label: 'Briefcase' },
  'building':    { icon: Building2,   label: 'Building'  },
  'users':       { icon: Users,       label: 'Team'      },
  'shield':      { icon: ShieldCheck, label: 'Shield'    },
  'zap':         { icon: Zap,         label: 'Activity'  },
  'book':        { icon: BookOpen,    label: 'Book'      },
  'wrench':      { icon: Wrench,      label: 'Tools'     },
  'hard-hat':    { icon: HardHat,     label: 'Hard Hat'  },
  'receipt':     { icon: Receipt,     label: 'Receipt'   },
  'scale':       { icon: Scale,       label: 'Scale'     },
  'ruler':       { icon: Ruler,       label: 'Ruler'     },
}

export type ColorOption = {
  name: string
  label: string
  textColor: string
  bgColor: string
  borderColor: string
  activeBorder: string
  activeBg: string
  activeText: string
  swatch: string
}

export const COLOR_OPTIONS: ColorOption[] = [
  { name: 'blue',   label: 'Blue',   textColor: 'text-blue-600',   bgColor: 'bg-blue-50',   borderColor: 'border-blue-200',   activeBorder: 'border-blue-500',   activeBg: 'bg-blue-50',   activeText: 'text-blue-700',   swatch: 'bg-blue-500'   },
  { name: 'amber',  label: 'Amber',  textColor: 'text-amber-600',  bgColor: 'bg-amber-50',  borderColor: 'border-amber-200',  activeBorder: 'border-amber-500',  activeBg: 'bg-amber-50',  activeText: 'text-amber-700',  swatch: 'bg-amber-500'  },
  { name: 'green',  label: 'Green',  textColor: 'text-green-600',  bgColor: 'bg-green-50',  borderColor: 'border-green-200',  activeBorder: 'border-green-500',  activeBg: 'bg-green-50',  activeText: 'text-green-700',  swatch: 'bg-green-500'  },
  { name: 'purple', label: 'Purple', textColor: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200', activeBorder: 'border-purple-500', activeBg: 'bg-purple-50', activeText: 'text-purple-700', swatch: 'bg-purple-500' },
  { name: 'cyan',   label: 'Cyan',   textColor: 'text-cyan-600',   bgColor: 'bg-cyan-50',   borderColor: 'border-cyan-200',   activeBorder: 'border-cyan-500',   activeBg: 'bg-cyan-50',   activeText: 'text-cyan-700',   swatch: 'bg-cyan-500'   },
  { name: 'indigo', label: 'Indigo', textColor: 'text-indigo-600', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200', activeBorder: 'border-indigo-500', activeBg: 'bg-indigo-50', activeText: 'text-indigo-700', swatch: 'bg-indigo-500' },
  { name: 'rose',   label: 'Rose',   textColor: 'text-rose-600',   bgColor: 'bg-rose-50',   borderColor: 'border-rose-200',   activeBorder: 'border-rose-500',   activeBg: 'bg-rose-50',   activeText: 'text-rose-700',   swatch: 'bg-rose-500'   },
  { name: 'orange', label: 'Orange', textColor: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200', activeBorder: 'border-orange-500', activeBg: 'bg-orange-50', activeText: 'text-orange-700', swatch: 'bg-orange-500' },
  { name: 'gray',   label: 'Gray',   textColor: 'text-gray-500',   bgColor: 'bg-gray-50',   borderColor: 'border-gray-200',   activeBorder: 'border-gray-400',   activeBg: 'bg-gray-50',   activeText: 'text-gray-700',   swatch: 'bg-gray-500'   },
]

export function buildCategory(
  value: string,
  label: string,
  description: string,
  iconName: string,
  colorName: string,
  dbId?: string,
  isCustom?: boolean,
): Category {
  const iconEntry = ICON_OPTIONS[iconName] ?? ICON_OPTIONS['folder']
  const color = COLOR_OPTIONS.find(c => c.name === colorName) ?? COLOR_OPTIONS[0]
  return {
    value, label, description,
    icon: iconEntry.icon,
    iconName, colorName,
    textColor:    color.textColor,
    bgColor:      color.bgColor,
    borderColor:  color.borderColor,
    activeBorder: color.activeBorder,
    activeBg:     color.activeBg,
    activeText:   color.activeText,
    dbId,
    isCustom: isCustom ?? false,
  }
}

export const CATEGORIES: Category[] = [
  {
    value: 'contracts', label: 'Contracts', description: 'Construction, supplier & service agreements',
    icon: FileCheck2, iconName: 'file-check', colorName: 'blue',
    textColor: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200',
    activeBorder: 'border-blue-500', activeBg: 'bg-blue-50', activeText: 'text-blue-700',
  },
  {
    value: 'site-reports', label: 'Site Reports', description: 'Progress, inspection & survey reports',
    icon: HardHat, iconName: 'hard-hat', colorName: 'amber',
    textColor: 'text-amber-600', bgColor: 'bg-amber-50', borderColor: 'border-amber-200',
    activeBorder: 'border-amber-500', activeBg: 'bg-amber-50', activeText: 'text-amber-700',
  },
  {
    value: 'finance', label: 'Finance', description: 'Invoices, budgets & payment schedules',
    icon: Receipt, iconName: 'receipt', colorName: 'green',
    textColor: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200',
    activeBorder: 'border-green-500', activeBg: 'bg-green-50', activeText: 'text-green-700',
  },
  {
    value: 'legal', label: 'Legal', description: 'Permits, title deeds & compliance docs',
    icon: Scale, iconName: 'scale', colorName: 'purple',
    textColor: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200',
    activeBorder: 'border-purple-500', activeBg: 'bg-purple-50', activeText: 'text-purple-700',
  },
  {
    value: 'design-plans', label: 'Design & Plans', description: 'Architectural drawings & specifications',
    icon: Ruler, iconName: 'ruler', colorName: 'cyan',
    textColor: 'text-cyan-600', bgColor: 'bg-cyan-50', borderColor: 'border-cyan-200',
    activeBorder: 'border-cyan-500', activeBg: 'bg-cyan-50', activeText: 'text-cyan-700',
  },
  {
    value: 'board-reports', label: 'Board Reports', description: 'Executive briefings & board minutes',
    icon: BarChart3, iconName: 'bar-chart', colorName: 'indigo',
    textColor: 'text-indigo-600', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200',
    activeBorder: 'border-indigo-500', activeBg: 'bg-indigo-50', activeText: 'text-indigo-700',
  },
  {
    value: 'general', label: 'General', description: 'Other workspace documents',
    icon: FolderOpen, iconName: 'folder', colorName: 'gray',
    textColor: 'text-gray-500', bgColor: 'bg-gray-50', borderColor: 'border-gray-200',
    activeBorder: 'border-gray-400', activeBg: 'bg-gray-50', activeText: 'text-gray-700',
  },
]

export const SENSITIVITIES = [
  { value: 'public',       label: 'Public',       desc: 'All workspace members' },
  { value: 'internal',     label: 'Internal',     desc: 'Team access (default)' },
  { value: 'confidential', label: 'Confidential', desc: 'Senior members only' },
  { value: 'restricted',   label: 'Restricted',   desc: 'Admins only' },
]

export function getCategoryByValue(value: string | null | undefined): Category | undefined {
  return CATEGORIES.find(c => c.value === value)
}

function toCategoryInit(cat: Category): CategoryInit {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { icon: _icon, ...rest } = cat
  return rest
}

export function mergeWithDbCategories(dbRows: DbCategory[]): CategoryInit[] {
  const defaultValues = new Set(CATEGORIES.map(c => c.value))

  const merged: CategoryInit[] = CATEGORIES.map(cat => {
    const override = dbRows.find(r => r.value === cat.value)
    if (override) {
      return toCategoryInit(
        buildCategory(cat.value, override.label, override.description,
          override.icon_name, override.color_name, override.id, false)
      )
    }
    return toCategoryInit(cat)
  })

  const customs: CategoryInit[] = dbRows
    .filter(r => !defaultValues.has(r.value))
    .map(r => toCategoryInit(
      buildCategory(r.value, r.label, r.description, r.icon_name, r.color_name, r.id, true)
    ))

  return [...merged, ...customs]
}
