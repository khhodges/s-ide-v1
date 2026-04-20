import React, { useState } from 'react';
import {
  Play,
  Square,
  Pause,
  StepForward,
  ChevronDown,
  Activity,
  Zap,
  Code2,
  Cpu,
  Layers,
  Box,
  Database,
  Settings,
  HardDrive,
  Download,
  BookOpen,
  FileText
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PolishContentFirst = () => {
  const [activeTab, setActiveTab] = useState('Create');
  const [machineState, setMachineState] = useState<'running' | 'paused' | 'fault'>('running');
  const [cycleCount, setCycleCount] = useState(148092);

  const tabs = [
    { id: 'Create', icon: Code2 },
    { id: 'Simulator', icon: Activity },
    { id: 'Pipeline', icon: Layers },
    { id: 'Registers', icon: Box },
    { id: 'Namespace', icon: Database },
  ];

  return (
    <div className="w-full h-screen flex flex-col font-sans overflow-hidden text-[#eaeaea]" style={{ backgroundColor: '#1a1a2e' }}>
      {/* 36px Toolbar */}
      <header 
        className="h-[36px] flex items-center justify-between px-3 border-b-2"
        style={{ 
          background: 'linear-gradient(to right, #0f0f23, #1a1a2e)',
          borderBottomColor: '#e94560'
        }}
      >
        <div className="flex items-center space-x-6 h-full">
          {/* Logo & Title */}
          <div className="flex items-center space-x-2 text-[#fbbf24]">
            <span className="font-bold text-lg leading-none mt-[2px]">λ</span>
            <span className="font-semibold text-[1rem] tracking-[1px] uppercase">Church Machine</span>
          </div>

          {/* Tab Strip */}
          <nav className="flex items-center h-full">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-full px-4 flex items-center space-x-1.5 text-sm transition-colors border-b-2 ${
                  activeTab === tab.id 
                    ? 'text-[#fbbf24] border-[#fbbf24]' 
                    : 'text-[#a0a0a0] border-transparent hover:text-[#eaeaea]'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.id}</span>
              </button>
            ))}

            {/* More Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="h-full px-4 flex items-center space-x-1 text-sm text-[#a0a0a0] hover:text-[#eaeaea] border-b-2 border-transparent outline-none">
                <span>More</span>
                <ChevronDown className="w-3 h-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-[#16213e] border-[#2d3748] text-[#eaeaea] rounded-none">
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Review</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><BookOpen className="w-4 h-4 mr-2" /> Abstractions</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><FileText className="w-4 h-4 mr-2" /> Reference</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2d3748]" />
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Hardware</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Cpu className="w-4 h-4 mr-2" /> Efinix Ti60</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Cpu className="w-4 h-4 mr-2" /> Tang Nano 20K</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2d3748]" />
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Configure & Install</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Settings className="w-4 h-4 mr-2" /> Devices</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><HardDrive className="w-4 h-4 mr-2" /> Lumps</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Download className="w-4 h-4 mr-2" /> Import</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>

        {/* Machine State Pill */}
        <div className="flex items-center space-x-3">
          <div 
            className="flex items-center space-x-2 px-2 py-0.5 rounded border border-[#2d3748] bg-[#0f0f23] cursor-pointer hover:bg-[#16213e] transition-colors"
            onClick={() => setMachineState(s => s === 'running' ? 'paused' : s === 'paused' ? 'fault' : 'running')}
          >
            {machineState === 'running' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse shadow-[0_0_8px_#4ade80]" />
                <span className="text-[10px] font-bold text-[#4ade80] tracking-wider">RUNNING</span>
              </>
            )}
            {machineState === 'paused' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                <span className="text-[10px] font-bold text-[#fbbf24] tracking-wider">PAUSED</span>
              </>
            )}
            {machineState === 'fault' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#e94560] animate-pulse shadow-[0_0_8px_#e94560]" />
                <span className="text-[10px] font-bold text-[#e94560] tracking-wider">FAULT</span>
              </>
            )}
            <div className="h-3 w-px bg-[#2d3748] mx-1" />
            <span className="text-xs font-mono text-[#a0a0a0] w-[8ch] text-right">
              {cycleCount.toLocaleString()}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0 bg-[#16213e]">
        {/* 32px Contextual Panel Header */}
        <div className="h-[32px] bg-[#1e2a3a] border-b border-[#2d3748] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#fbbf24]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#eaeaea]">
              {activeTab}
            </span>
          </div>
          
          {/* Contextual Controls based on active tab */}
          <div className="flex items-center space-x-1">
            {activeTab === 'Create' && (
              <>
                <button className="px-3 h-6 flex items-center space-x-1.5 bg-[#0f3460] hover:bg-[#1a4a8a] text-white text-xs rounded transition-colors border border-[#2d3748]">
                  <Download className="w-3 h-3" />
                  <span>Build</span>
                </button>
                <button className="px-3 h-6 flex items-center space-x-1.5 bg-[#e94560] hover:bg-[#ff5a75] text-white text-xs rounded transition-colors ml-2 shadow-[0_0_10px_rgba(233,69,96,0.3)]">
                  <Play className="w-3 h-3" />
                  <span>Deploy to Simulator</span>
                </button>
              </>
            )}
            
            {activeTab === 'Simulator' && (
              <>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Pause className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <StepForward className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-[#2d3748] mx-1" />
                <button className="w-7 h-6 flex items-center justify-center text-[#e94560] hover:bg-[#2d3748] rounded transition-colors">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Square className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Dynamic Panel Content */}
        <div className="flex-1 overflow-hidden p-4 relative">
          {activeTab === 'Create' && (
            <div className="absolute inset-4 bg-[#0f3460] border border-[#2d3748] rounded shadow-inner font-mono text-sm overflow-hidden flex flex-col">
              <div className="h-8 bg-[#0a2548] border-b border-[#2d3748] flex items-center px-4 text-xs text-[#a0a0a0] space-x-4">
                <span className="text-[#eaeaea] border-b border-[#fbbf24] h-full flex items-center pt-px">boot.cloomc</span>
                <span className="hover:text-[#eaeaea] cursor-pointer transition-colors">math.cloomc</span>
                <span className="hover:text-[#eaeaea] cursor-pointer transition-colors">init.cloomc</span>
              </div>
              <div className="flex-1 overflow-auto p-4 leading-relaxed">
                <div className="flex">
                  <div className="w-8 text-right pr-4 text-[#2d3748] select-none">
                    1<br/>2<br/>3<br/>4<br/>5<br/>6<br/>7<br/>8<br/>9<br/>10<br/>11<br/>12<br/>13<br/>14<br/>15<br/>16
                  </div>
                  <div className="flex-1 whitespace-pre">
                    <span className="text-[#a0a0a0] italic">; Church Machine Boot Sequence</span>{'\n'}
                    <span className="text-[#a0a0a0] italic">; Initializes the root namespace and loads LUMP 0</span>{'\n\n'}
                    
                    <span className="text-[#60a5fa] font-bold">.namespace</span> <span className="text-[#eaeaea]">System.Boot</span>{'\n\n'}
                    
                    <span className="text-[#eaeaea]">start:</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">LOAD</span>   DR0, <span className="text-[#fbbf24]">0x00000000</span>    <span className="text-[#a0a0a0] italic">; Base address of boot ROM</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">LOAD</span>   DR1, [<span className="text-[#eaeaea]">DR0</span>+<span className="text-[#4ade80]">4</span>]        <span className="text-[#a0a0a0] italic">; Read LUMP count</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">CMP</span>    DR1, <span className="text-[#4ade80]">0</span>             <span className="text-[#a0a0a0] italic">; Check if any LUMPs exist</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">JEQ</span>    fault_halt         <span className="text-[#a0a0a0] italic">; Halt if no LUMPs found</span>{'\n\n'}
                    
                    {'  '}<span className="text-[#a0a0a0] italic">; Setup namespace</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">CALL</span>   <span className="text-[#eaeaea]">System.Namespace.Create</span>{'\n'}
                    {'  '}<span className="text-[#60a5fa]">SAVE</span>   CR0, <span className="text-[#eaeaea]">DR2</span>             <span className="text-[#a0a0a0] italic">; Store namespace capability</span>{'\n\n'}
                    
                    {'  '}<span className="text-[#60a5fa]">JMP</span>    load_loop{'\n\n'}
                    
                    <span className="text-[#eaeaea]">fault_halt:</span>{'\n'}
                    {'  '}<span className="text-[#e94560]">FAULT</span>  <span className="text-[#4ade80]">0x01</span>               <span className="text-[#a0a0a0] italic">; ERR_NO_BOOT_LUMP</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab !== 'Create' && (
            <div className="absolute inset-4 border border-[#2d3748] rounded bg-[#0f3460]/20 flex items-center justify-center text-[#a0a0a0]">
              <div className="text-center">
                <Box className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Content for {activeTab} view</p>
                <p className="text-xs mt-2 opacity-50">Wire up in subsequent iterations</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default PolishContentFirst;
