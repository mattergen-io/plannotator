import json,subprocess,pathlib,hashlib,sys
p=json.load(open(sys.argv[1]));root=pathlib.Path(p['root']);c=pathlib.Path(p['control'])
def cmd(args,cwd=root):return subprocess.check_output(args,cwd=cwd,text=True)
a=json.loads(cmd(['bd','list','--label','bb-factory','--all','--limit','1000','--json']))
r=next(b for b in a if b['metadata']['bbFactory']['kind']=='run');run=r['metadata']['bbFactory'];w=pathlib.Path(run['worktree']);base=(c/'starting-head.txt').read_text().strip()
assert r['status']=='closed' and run['stage']=='complete'
assert cmd(['git','rev-parse','HEAD']).strip()==base
assert cmd(['git','branch','--show-current'])==(c/'starting-branch.txt').read_text()
assert not cmd(['git','status','--porcelain']).strip()
assert not cmd(['git','diff','--name-only',base,run['branch'],'--','.kiro','AGENTS.md','guard.txt','baseline.test.mjs']).strip()
assert not cmd(['git','status','--porcelain'],w).strip()
assert not (c/'fail-once.json').exists()
checks=c/'independent-api-check.mjs';checks.write_text('''import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.argv[2];
const {add}=await import(pathToFileURL(path.join(root,'src/add.mjs')));
const {subtract}=await import(pathToFileURL(path.join(root,'src/subtract.mjs')));
const {calculate}=await import(pathToFileURL(path.join(root,'src/calculate.mjs')));
let assertions=0;
for(const [a,b] of [[0,0],[0,-4],[-4,0],[-7,-3],[4,-9],[0.1,0.2],[1.25,-0.5]]) {
 assert.equal(add(a,b),a+b); assert.equal(subtract(a,b),a-b);
 assert.equal(calculate('add',a,b),a+b);assert.equal(calculate('subtract',a,b),a-b);assertions+=4;
}
for(const op of ['',null,undefined,'ADD','multiply',1,{}]){assert.throws(()=>calculate(op,2,3),Error);assertions++;}
console.log(`${assertions} independent API assertions passed`);
''')
api=cmd(['node',str(checks),str(w)]);tests=cmd(['node','--test'],w)
report={'projectId':p['project']['id'],'plannerId':p['plannerId'],'root':str(root),'runId':r['id'],'stage':run['stage'],'branch':run['branch'],'integration':str(w),'startingHead':base,'factoryHead':cmd(['git','rev-parse','HEAD'],w).strip(),'startingBranchUnchanged':True,'protectedFilesUnchanged':True,'bothWorkspacesClean':True,'independentApiCheck':api.strip(),'testOutput':tests,'preStartReady':json.loads((c/'prestart-readiness.json').read_text()),'worker':run['worker'],'reviewer':run['reviewer'],'tasks':[],'threadExecutionEvidence':[]}
for b in a:
 s=b['metadata']['bbFactory']
 if s['kind']!='task':continue
 assert b['status']=='closed' and s['stage']=='done'
 assert hashlib.sha256(b['description'].encode()).hexdigest()==s['packHash']
 changed=cmd(['git','diff','--name-only',s['base'],s['commit']]).splitlines()
 report['tasks'].append({'beadId':b['id'],'key':s['key'],'status':b['status'],'stage':s['stage'],'attempts':s['attempts'],'dependencies':s['dependencies'],'base':s['base'],'commit':s['commit'],'changedFiles':changed,'workerId':s['workerId'],'reviewerId':s['reviewerId'],'packHash':s['packHash'],'checkFailures':[x for x in s['evidence'] if 'Controlled one-time acceptance-test verification failure' in x]})
 for role in ['worker','reviewer']:
  tid=s[role+'Id'];events=json.loads(cmd(['bb','thread','log',tid,'--json','--all']))
  requested=next(e for e in events if e['type']=='client/turn/requested')
  execution=requested['data']['execution'];expected=run[role]
  assert execution['model']==expected['model'] and execution['reasoningLevel']==expected['reasoningLevel']
  final=json.loads(cmd(['bb','thread','output',tid,'--json']))
  if role=='reviewer':assert final['output'].strip().endswith('FACTORY_REVIEW: PASS')
  report['threadExecutionEvidence'].append({'threadId':tid,'role':role,'eventSequence':requested['seq'],'createdAt':requested['createdAt'],'execution':{k:execution.get(k) for k in ['providerId','model','reasoningLevel']},'finalOutput':final['output']})
(c/'live-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['tasks','threadExecutionEvidence','testOutput']},indent=2))
print(tests[-900:])
