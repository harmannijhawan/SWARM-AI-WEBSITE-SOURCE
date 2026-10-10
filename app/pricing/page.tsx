import Link from 'next/link';
import {planCatalog} from '@/lib/server/entitlements';
import { Sparkles, Zap, ShieldCheck, Check } from 'lucide-react';
export const dynamic='force-dynamic';
export default function Pricing(){
  const {free,pro}=planCatalog();
  return <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-6 py-16">
    <div className="mx-auto max-w-5xl space-y-12">
      <div className="text-center space-y-4">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors">
          ← Back to SWARM AI
        </Link>
        <h1 className="premium-heading-xl">One account. Managed AI.</h1>
        <p className="premium-body max-w-2xl mx-auto">
          Start building without provider accounts or API keys. SWARM SWE coordinates the eligible models available through SWARM.
        </p>
      </div>
      
      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        {/* Free Plan */}
        <section className="premium-card-elevated p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="premium-heading-lg">Free</h2>
            <p className="premium-heading-xl">₹0</p>
            <p className="premium-body-sm">Forever free to get started</p>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-green-600" />
              </div>
              <span className="premium-body">{free.builds} build runs per {free.days}-day period</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-green-600" />
              </div>
              <span className="premium-body">{free.chats} chat interactions per {free.days}-day period</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-green-600" />
              </div>
              <span className="premium-body">SWARM SWE automatic routing</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-green-600" />
              </div>
              <span className="premium-body">Project history & preferences</span>
            </div>
          </div>
          
          <Link 
            className="premium-button premium-button-secondary w-full justify-center py-3"
            href="/sign-up"
          >
            Create your SWARM account
          </Link>
        </section>
        
        {/* Pro Plan */}
        <section className="premium-card-elevated p-8 space-y-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-gradient-to-l from-violet-500 to-violet-600 text-white text-xs font-semibold px-3 py-1 rounded-bl-lg">
            POPULAR
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="premium-heading-lg">Pro</h2>
              <Sparkles className="w-5 h-5 text-violet-500" />
            </div>
            <p className="premium-heading-xl">
              {pro.price===null ? 'Price unavailable' : '₹' + (pro.price/100).toLocaleString('en-IN')}
            </p>
            <p className="premium-body-sm">for {pro.accessDays} days</p>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-violet-600" />
              </div>
              <span className="premium-body">{pro.builds??'build capacity awaiting configuration'} builds per {pro.days}-day period</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-violet-600" />
              </div>
              <span className="premium-body">{pro.chats??'chat capacity awaiting configuration'} chats per {pro.days}-day period</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-violet-600" />
              </div>
              <span className="premium-body">Premium model eligibility</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-violet-600" />
              </div>
              <span className="premium-body">No additional provider credentials</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <Check className="w-3 h-3 text-violet-600" />
              </div>
              <span className="premium-body">Manual renewal, no auto-charge</span>
            </div>
          </div>
          
          <Link 
            className="premium-button premium-button-primary w-full justify-center py-3"
            href="/app/settings"
          >
            Upgrade to Pro
          </Link>
        </section>
      </div>
      
      <div className="grid gap-6 md:grid-cols-3">
        <div className="premium-card p-6 text-center space-y-3">
          <Zap className="w-8 h-8 mx-auto text-violet-500" />
          <h3 className="premium-heading-md">Fast Routing</h3>
          <p className="premium-body-sm">Automatic model selection based on your task</p>
        </div>
        <div className="premium-card p-6 text-center space-y-3">
          <ShieldCheck className="w-8 h-8 mx-auto text-violet-500" />
          <h3 className="premium-heading-md">Secure & Private</h3>
          <p className="premium-body-sm">Your data stays encrypted and isolated</p>
        </div>
        <div className="premium-card p-6 text-center space-y-3">
          <Sparkles className="w-8 h-8 mx-auto text-violet-500" />
          <h3 className="premium-heading-md">Premium Models</h3>
          <p className="premium-body-sm">Access advanced reasoning models when available</p>
        </div>
      </div>
      
      <div className="premium-alert premium-alert-info">
        <p className="premium-body-sm">
          <strong>Note:</strong> Availability depends on configured models, legitimate provider quotas and SWARM usage policies. 
          Prompts are processed by the configured third-party AI services. Checkout shows the configured INR amount. 
          Payment processing uses the server-configured Cashfree environment.
        </p>
      </div>
    </div>
  </main>;
}
