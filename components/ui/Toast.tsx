
import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { AppNotification } from '../../types';

interface ToastProps {
  notification: AppNotification;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ notification, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small delay to trigger animation
    const t1 = setTimeout(() => setIsVisible(true), 10);
    // Auto hide after 5 seconds
    const t2 = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for fade out animation
    }, 5000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onClose]);

  const getIcon = () => {
    switch (notification.type) {
      case 'SUCCESS': return <CheckCircle size={20} className="text-green-500" />;
      case 'WARNING': return <AlertTriangle size={20} className="text-amber-500" />;
      default: return <Bell size={20} className="text-blue-500" />;
    }
  };

  const getBorderColor = () => {
    switch (notification.type) {
      case 'SUCCESS': return 'border-l-green-500';
      case 'WARNING': return 'border-l-amber-500';
      default: return 'border-l-blue-500';
    }
  };

  return (
    <div 
      className={`fixed top-4 right-4 z-[100] max-w-sm w-full bg-white shadow-2xl rounded-lg overflow-hidden border-l-4 ${getBorderColor()} transition-all duration-300 transform ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}
    >
      <div className="p-4 flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          {getIcon()}
        </div>
        <div className="flex-1">
          <h4 className="font-bold text-gray-800 text-sm">{notification.title}</h4>
          <p className="text-gray-600 text-xs mt-1 leading-relaxed">{notification.message}</p>
          <p className="text-gray-400 text-[10px] mt-2">{new Date(notification.timestamp).toLocaleTimeString()}</p>
        </div>
        <button onClick={() => { setIsVisible(false); setTimeout(onClose, 300); }} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export const ToastContainer: React.FC<{notifications: AppNotification[], onRemove: (id: string) => void}> = ({ notifications, onRemove }) => {
  return (
    <>
      {notifications.map((n, idx) => (
        <div key={n.id} style={{ top: `${1 + (idx * 6)}rem` }} className="fixed right-4 z-[100] w-full max-w-sm pointer-events-none">
          {/* Wrapper to allow stacking relative positioning, but inner pointer-events-auto */}
          <div className="pointer-events-auto"> 
             <Toast notification={n} onClose={() => onRemove(n.id)} />
          </div>
        </div>
      ))}
    </>
  );
};
