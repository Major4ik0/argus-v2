import React from 'react'
import { AdminKioskTab } from './AdminKioskTab'

interface KioskAdminModalProps {
  isOpen: boolean
  onClose: () => void
}

export const KioskAdminModal: React.FC<KioskAdminModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-6xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col h-[92vh] overflow-hidden text-slate-100">
        <AdminKioskTab onClose={onClose} isStandalone={true} />
      </div>
    </div>
  )
}

export default KioskAdminModal
