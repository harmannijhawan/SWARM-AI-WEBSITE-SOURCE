import { notFound } from 'next/navigation'
import SwarmSite from '@/components/swarm-site'

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  if(!['agents','platform','cloud','how-it-works','projects','activity','about','documentation','changelog','privacy'].includes(slug.join('/')))notFound()
  return <SwarmSite page={slug.join('/')} />
}
