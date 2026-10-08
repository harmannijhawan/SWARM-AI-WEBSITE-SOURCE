import SwarmSite from '@/components/swarm-site'

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  return <SwarmSite page={slug.join('/')} />
}
