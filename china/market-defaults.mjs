import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {parseCompensation, hasUnsupportedPayRate} from '../compensation.mjs';
// A pay period the shared parser cannot express (per hour, per week, per visit,
// per person-day). Recognising it here keeps the monthly default from
// relabelling e.g. "80-250元/时" as a 165 CNY/month salary. The regex lives in
// compensation.mjs so the parser, the annualizer and these defaults agree.
export const hasUnsupportedPayPeriod=hasUnsupportedPayRate;

export function loadMarketDefaults(root){const path=join(root,'data/china/market-defaults.json');return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};}
export function applySalaryDefaults(c,policy={}){
 if(!c?.raw||!policy.currency||!policy.period)return c;
 const raw=c.raw;
 const explicitCurrency=/USD|美元|US\$/i.test(raw)?'USD':/EUR|欧元|€/i.test(raw)?'EUR':/人民币|CNY|RMB/i.test(raw)?'CNY':null;
 const explicitPeriod=/\/\s*(?:天|日|day\b)|日薪|每天/i.test(raw)?'day':/\/\s*(?:年|year\b|yr\b)|年薪|每年/i.test(raw)?'year':/\/\s*(?:月|month\b|mo\b)|月薪|每月/i.test(raw)?'month':null;
 // A visible rate the shared parser cannot express (per hour, per week, per
 // visit, per person-day) must not borrow the monthly default: relabelling
 // "80-250元/时" as monthly turned an hourly rate into a 165 CNY/month salary
 // and pulled the low end of every salary distribution with it. Leave it
 // unknown; the raw text stays on the fact for a later explicit rule.
 const knownPeriod=['month','year','day'].includes(c.period);
 if(!knownPeriod&&!explicitPeriod&&hasUnsupportedPayPeriod(raw))return {...c,period:null,status:'unknown',min:null,max:null,annualizedMonthly:null,advertisedAnnualCash:null};
 return parseCompensation({raw,currency:c.currency||explicitCurrency||policy.currency,period:c.period||explicitPeriod||policy.period,evidence:[...(c.evidence||[]),{field:'userDefault',quote:JSON.stringify(policy)}]});
}
export function applyChannelDefault(channel,policy={}){
 return (!channel?.value||channel.value==='unknown')&&policy.channel?{...channel,value:policy.channel,status:'assumed',reason:'用户规则：未明确标记猎头时，默认按HR发布；不代表已核实雇主或劳动关系。',originalValue:channel?.value||'unknown'}:channel;
}
