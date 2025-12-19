import React, { useState, useEffect } from 'react';
import { db } from './services/db';
import { ViewState } from './types';
import { AdminView } from './components/AdminView';
import { DriverView } from './components/DriverView';
import { Smartphone, Monitor, ShieldCheck, Truck, Lock, ChevronLeft, AlertCircle, Sun, Moon, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>({ type: 'ROLE_SELECT' });
  
  // Theme State
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'light';
    }
    return 'light';
  });

  // Login State
  const [loginSelectedDriverId, setLoginSelectedDriverId] = useState<string | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Admin Login State
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');

  useEffect(() => {
    db.init();
  }, []);

  // Theme Effect
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleDriverLoginAttempt = (driverId: string) => {
    setLoginSelectedDriverId(driverId);
    setLoginPassword('');
    setLoginError('');
  };

  const confirmDriverLogin = async () => {
    if (loginSelectedDriverId) {
       const isValid = await db.verifyDriverCredentials(loginSelectedDriverId, loginPassword);
       if (isValid) {
         setView({ type: 'DRIVER_LIST', driverId: loginSelectedDriverId });
         setLoginSelectedDriverId(null); 
         setLoginPassword('');
         setLoginError('');
       } else {
         setLoginError("Senha incorreta. Tente novamente.");
       }
    }
  };

  const confirmAdminLogin = async () => {
    const isValid = await db.verifyAdminPassword(adminPassword);
    if (isValid) {
      setView({ type: 'ADMIN_DASHBOARD' });
      setAdminPassword('');
      setAdminLoginError('');
    } else {
      setAdminLoginError("Senha incorreta. Tente novamente.");
    }
  };

  const renderContent = () => {
    switch (view.type) {
      case 'ROLE_SELECT':
        return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4 transition-colors duration-300 relative">
            
            {/* Theme Toggle Button */}
            <button 
              onClick={toggleTheme}
              className="absolute top-6 right-6 p-3 bg-white dark:bg-slate-800 shadow-lg rounded-full text-slate-600 dark:text-yellow-400 hover:scale-110 transition-all border border-slate-200 dark:border-slate-700"
              title="Alternar Tema"
            >
              {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
            </button>

            <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8">
              
              {/* Intro Text */}
              <div className="text-slate-900 dark:text-white space-y-6 flex flex-col justify-center">
                <div>
                   <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-500 dark:from-blue-400 dark:to-emerald-400">
                     EntregaCerta
                   </h1>
                   <p className="text-slate-600 dark:text-slate-400 text-lg md:text-xl leading-relaxed">
                     O sistema definitivo de canhoto digital para logística moderna. 
                     Elimine papel, rastreie em tempo real e garanta validade jurídica.
                   </p>
                </div>
                <div className="flex gap-4 text-sm font-mono text-slate-500 dark:text-slate-500">
                  <span>v1.2.0 Cloud</span>
                  <span>•</span>
                  <span>Mobile First</span>
                </div>
              </div>

              {/* Selection Cards */}
              <div className="space-y-4">
                 <button 
                    onClick={() => setView({ type: 'DRIVER_LOGIN' })}
                    className="w-full group bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 transition-all p-6 rounded-2xl flex items-center justify-between shadow-xl border border-transparent dark:border-slate-700"
                 >
                    <div className="text-left">
                       <h3 className="text-2xl font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">Sou Motorista</h3>
                       <p className="text-slate-500 dark:text-slate-400 mt-1">Acessar rotas e realizar baixas.</p>
                    </div>
                    <div className="h-14 w-14 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                       <Smartphone size={28} />
                    </div>
                 </button>

                 <button 
                    onClick={() => setView({ type: 'ADMIN_LOGIN' })}
                    className="w-full group bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all p-6 rounded-2xl flex items-center justify-between border border-slate-200 dark:border-slate-700 shadow-xl"
                 >
                    <div className="text-left">
                       <h3 className="text-2xl font-bold text-slate-800 dark:text-white">Gestor</h3>
                       <p className="text-slate-500 dark:text-slate-400 mt-1">Painel de controle e monitoramento.</p>
                    </div>
                    <div className="h-14 w-14 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:scale-110 transition-transform">
                       <Monitor size={28} />
                    </div>
                 </button>
              </div>

            </div>
          </div>
        );

      case 'ADMIN_LOGIN':
        return (
          <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4 transition-colors duration-300">
             <div className="bg-white dark:bg-slate-800 w-full max-w-sm p-8 rounded-2xl shadow-xl space-y-6 animate-in fade-in zoom-in duration-200 border border-slate-100 dark:border-slate-700">
                <button onClick={() => {
                  setView({ type: 'ROLE_SELECT' });
                  setAdminLoginError('');
                }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <ChevronLeft />
                </button>
                <div className="text-center">
                   <div className="mx-auto w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-700 dark:text-slate-200 mb-4 border-4 border-slate-50 dark:border-slate-600">
                      <Lock size={32} />
                   </div>
                   <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Acesso Restrito</h2>
                   <p className="text-slate-500 dark:text-slate-400 text-sm">Área exclusiva para gestão de frota.</p>
                </div>
                
                <div className="space-y-4">
                  <input 
                     type="password" 
                     autoFocus
                     placeholder="Senha de Administrador" 
                     className={`w-full text-center text-lg p-3 border rounded-lg outline-none focus:ring-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${adminLoginError ? 'border-red-300 focus:ring-red-500 bg-red-50 dark:bg-red-900/10' : 'border-slate-300 dark:border-slate-600 focus:ring-slate-500'}`}
                     value={adminPassword}
                     onChange={e => {
                       setAdminPassword(e.target.value);
                       setAdminLoginError('');
                     }}
                     onKeyDown={e => {
                       if (e.key === 'Enter') confirmAdminLogin();
                     }}
                   />
                   
                   {adminLoginError && (
                     <div className="flex items-center justify-center gap-2 text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded-md animate-in fade-in slide-in-from-top-1">
                        <AlertCircle size={16} /> {adminLoginError}
                     </div>
                   )}

                   <button 
                     onClick={confirmAdminLogin} 
                     className="w-full bg-slate-800 dark:bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-slate-700 dark:hover:bg-blue-700 transition-colors shadow-lg"
                   >
                     Entrar
                   </button>
                </div>
             </div>
          </div>
        );

      case 'DRIVER_LOGIN':
        return (
          <DriverLoginScreen 
            onBack={() => setView({ type: 'ROLE_SELECT' })}
            onSelectDriver={handleDriverLoginAttempt}
            driversListPromise={db.getDrivers()} // Passamos a Promise
          />
        );

       case 'ADMIN_DASHBOARD':
        return (
           <div className="relative">
              {/* ADICIONADO: Passando as props toggleTheme e theme */}
              <AdminView toggleTheme={toggleTheme} theme={theme} />
              
              <button 
                onClick={() => setView({ type: 'ROLE_SELECT' })}
                className="fixed bottom-4 right-4 bg-slate-800 text-white text-xs px-3 py-2 rounded-full shadow-lg opacity-70 hover:opacity-100 transition-opacity z-50"
              >
                Sair do Admin
              </button>
           </div>
        );

      case 'DRIVER_LIST':
        return (
          <DriverView 
            driverId={view.driverId} 
            onLogout={() => setView({ type: 'ROLE_SELECT' })}
            // ADICIONADO: Passando as props aqui também
            toggleTheme={toggleTheme}
            theme={theme}
          />
        );
        
      default:
        return <div>Unknown View</div>;
    }
  };

  // Login Modal
  const loginModal = loginSelectedDriverId && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
       <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xs p-6 space-y-4 border border-slate-200 dark:border-slate-700">
          <div className="text-center">
            <div className="mx-auto w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 mb-2">
              <Lock size={20} />
            </div>
            <h3 className="font-bold text-slate-800 dark:text-white">Digite sua Senha</h3>
          </div>
          <input 
            type="password" 
            autoFocus
            placeholder="Senha..." 
            className={`w-full text-center text-xl tracking-widest p-3 border rounded-lg outline-none focus:ring-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white ${loginError ? 'border-red-300 focus:ring-red-500 bg-red-50 dark:bg-red-900/10' : 'border-slate-300 dark:border-slate-600 focus:ring-orange-500'}`}
            value={loginPassword}
            onChange={e => {
              setLoginPassword(e.target.value);
              setLoginError('');
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') confirmDriverLogin();
            }}
          />

          {loginError && (
            <div className="flex items-center justify-center gap-1 text-red-500 text-xs font-bold animate-in fade-in slide-in-from-top-1">
               <AlertCircle size={12} /> {loginError}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setLoginSelectedDriverId(null)} className="flex-1 py-2 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg font-medium text-sm">Cancelar</button>
            <button onClick={confirmDriverLogin} className="flex-1 py-2 bg-orange-600 text-white rounded-lg font-medium text-sm hover:bg-orange-700">Entrar</button>
          </div>
       </div>
    </div>
  );

  return (
    <>
      {renderContent()}
      {loginModal}
    </>
  );
};

// Subcomponente para Login
const DriverLoginScreen: React.FC<{onBack: () => void, onSelectDriver: (id: string) => void, driversListPromise: Promise<any[]>}> = ({ onBack, onSelectDriver, driversListPromise }) => {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    driversListPromise.then(d => {
      setDrivers(d);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900 flex items-center justify-center p-4 transition-colors duration-300">
        <div className="bg-white dark:bg-slate-800 w-full max-w-md p-8 rounded-2xl shadow-xl space-y-6 border border-slate-200 dark:border-slate-700">
          <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center text-orange-600 dark:text-orange-400 mb-4">
                <Truck size={32} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Identifique-se</h2>
              <p className="text-gray-500 dark:text-slate-400">Selecione seu perfil para iniciar.</p>
          </div>
          
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-8">
                  <Loader2 className="mx-auto animate-spin text-orange-500 mb-2" />
                  <span className="text-xs text-gray-400">Carregando motoristas...</span>
              </div>
            ) : drivers.length === 0 ? (
              <div className="text-center text-gray-400 dark:text-slate-500 py-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg">
                  Nenhum motorista cadastrado no sistema.
              </div>
            ) : (
              drivers.map(d => (
                <button
                  key={d.id}
                  onClick={() => onSelectDriver(d.id)}
                  className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-slate-700 transition-all flex items-center justify-between group"
                >
                  <div>
                    <span className="block font-bold text-gray-800 dark:text-white">{d.name}</span>
                    <span className="text-xs text-gray-400 dark:text-slate-400">Motorista</span>
                  </div>
                  <ShieldCheck className="text-gray-300 dark:text-slate-500 group-hover:text-orange-500" />
                </button>
              ))
            )}
          </div>

          <button 
            onClick={onBack}
            className="w-full py-3 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 text-sm font-medium"
          >
            Voltar
          </button>
        </div>
    </div>
  );
};

export default App;