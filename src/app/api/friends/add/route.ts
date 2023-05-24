import {addFriendValidator} from "@/lib/validation/add-friend";
import {getServerSession} from "next-auth";
import {authOptions} from "@/lib/auth";
import {Response} from "next/dist/compiled/@edge-runtime/primitives/fetch";
import {fetchRedis} from "@/helpers/redis";
import {db} from "@/lib/db";
import {z} from "zod";
import {pusherServer} from "@/lib/pusher";
import {toPusherKey} from "@/lib/util";

export async function POST(req: Request) {
    try {
        const body = await req.json()

        const {email: emailToAdd} = addFriendValidator.parse(body.email)

        const idToAdd = await fetchRedis('get', `user:email:${emailToAdd}`) as string
        // const RESTResponse = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/user:email${emailToAdd}`, {
        //         headers: {
        //             Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        //         },
        //         cache: 'no-store',
        //     }
        // )
        //
        // const data = await RESTResponse.json() as {result: string | null}
        //
        // const idToAdd = data.result

        if(!idToAdd) {
            return new Response('User not found', {status: 400})
        }

        const session = await getServerSession(authOptions)

        if(!session) {
            return new Response('Unauthorized', {status: 401})
        }

        if (idToAdd === session.user.id) {
            return new Response('You cannot add yourself as a friend', {status: 400})
        }

        // check if user is already added
        const isAlreadyAdded = (await fetchRedis(
            'sismember',
            `user:${idToAdd}:incoming_friend_requests`,
            session.user.id)) as 0 | 1

        if(isAlreadyAdded) {
            return new Response('User is already added', {status: 400})
        }

        // check if user is already added
        const isAlreadyFriends = (await fetchRedis(
            'sismember',
            `user:${session.user.id}:friends`,
            idToAdd)) as 0 | 1

        if(isAlreadyFriends) {
            return new Response('Already friends with this user', {status: 400})
        }

        // valid request. sent friend request
        pusherServer.trigger(
            toPusherKey(`user:${idToAdd}:incoming_friend_requests`),
            'incoming_friend_requests',
            {
                senderId: session.user.id,
                senderEmail: session.user.email,
            }
        )

        db.sadd(`user:${idToAdd}:incoming_friend_requests`, session.user.id)

        return new Response('OK', {status: 200})
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new Response('Invalid request payload', {status: 422})
        }

        return new Response('Invalid Request', {status: 400})
    }
}