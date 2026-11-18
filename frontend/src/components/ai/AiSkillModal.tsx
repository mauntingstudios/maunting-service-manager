import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@maunting/ui'
import { AiSkillDirectory } from './AiSkillDirectory'

interface AiSkillModalProps {
  open: boolean
  onClose: () => void
}

export function AiSkillModal({ open, onClose }: AiSkillModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex flex-col max-w-3xl max-h-[85vh] overflow-hidden" aria-labelledby="skills-modal-title">
        <DialogHeader className="bg-surface-container-high/40 pr-14">
          <DialogTitle id="skills-modal-title" className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('ai.skills.directoryTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <AiSkillDirectory />
        </div>
      </DialogContent>
    </Dialog>
  )
}
