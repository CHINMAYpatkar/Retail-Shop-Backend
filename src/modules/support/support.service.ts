import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { generateTicketNumber } from '../../common/utils/order-number';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { QueryTicketsAdminDto } from './dto/query-tickets-admin.dto';

const TICKET_INCLUDE = {
  messages: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(dto: CreateTicketDto, customerId?: string) {
    let ticketNumber = generateTicketNumber();
    while (await this.prisma.supportTicket.findUnique({ where: { ticketNumber } })) {
      ticketNumber = generateTicketNumber();
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        customerId,
        name: dto.name,
        email: dto.email,
        subject: dto.subject,
        messages: {
          create: { senderType: 'customer', senderName: dto.name, message: dto.message },
        },
      },
      include: TICKET_INCLUDE,
    });

    await this.mail.sendMail(
      dto.email,
      `We received your message - ${ticketNumber}`,
      `<p>Thanks for reaching out. Your ticket <b>${ticketNumber}</b> has been created and our team will respond shortly.</p>`,
    );

    return ticket;
  }

  findAllForCustomer(customerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: TICKET_INCLUDE,
    });
  }

  async findOneForCustomer(customerId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.customerId !== customerId) throw new ForbiddenException('Not your ticket');
    return ticket;
  }

  async addCustomerMessage(customerId: string, ticketId: string, message: string) {
    const ticket = await this.findOneForCustomer(customerId, ticketId);
    await this.prisma.ticketMessage.create({
      data: { ticketId: ticket.id, senderType: 'customer', senderName: ticket.name, message },
    });
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      await this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'OPEN' },
      });
    }
    return this.prisma.supportTicket.findUnique({
      where: { id: ticket.id },
      include: TICKET_INCLUDE,
    });
  }

  // ---------- Admin ----------

  async findAllAdmin(query: QueryTicketsAdminDto) {
    const { page = 1, limit = 20, status, search } = query;
    const where: Prisma.SupportTicketWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { ticketNumber: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneAdmin(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async addAdminReply(id: string, message: string, adminName?: string) {
    const ticket = await this.findOneAdmin(id);
    await this.prisma.ticketMessage.create({
      data: { ticketId: ticket.id, senderType: 'admin', senderName: adminName, message },
    });
    if (ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'IN_PROGRESS' },
      });
    }
    await this.mail.sendMail(
      ticket.email,
      `Update on your ticket - ${ticket.ticketNumber}`,
      `<p>${message}</p>`,
    );
    return this.prisma.supportTicket.findUnique({
      where: { id: ticket.id },
      include: TICKET_INCLUDE,
    });
  }

  async updateStatus(id: string, status: TicketStatus) {
    await this.findOneAdmin(id);
    return this.prisma.supportTicket.update({ where: { id }, data: { status } });
  }
}
