import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
const App=lazy(()=>import('./App'));
const FxAssistant=lazy(()=>import('./components/FxAssistant').then(m=>({default:m.FxAssistant})));
import './styles.css';
const fx=new URLSearchParams(location.search).get('fx-assistant');
createRoot(document.getElementById('root')!).render(<Suspense>{fx?<FxAssistant locale={fx==='en'?'en':'zh-CN'}/>:<App/>}</Suspense>);
